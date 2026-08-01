"""
Convertit un export de copies Moodle en jeu d'évaluation Coteris.

    python scripts/convertir-moodle.py --copies benchmark/data/gss4408 \
        --corrige benchmark/data/gss4408/corrige-type.docx \
        --sortie benchmark/data/gss4408/jeu.json

Ce script ne fabrique **aucune décision de référence**. Il extrait ce qui existe
réellement dans les fichiers : énoncés, barèmes, réponses des étudiants, et les
critères tels que le corrigé les décompose.

Les décisions de référence — ce qu'un correcteur humain accorde, critère par
critère — doivent être saisies séparément. Sans elles il n'y a rien à comparer,
et le script produit une feuille de notation à remplir plutôt que d'inventer
des valeurs.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
import zipfile
from pathlib import Path

import pdfplumber


# --- Lecture du corrigé -------------------------------------------------------


def texte_docx(chemin: Path) -> str:
    with zipfile.ZipFile(chemin) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
    texte = re.sub(r"<[^>]+>", "", xml)
    texte = texte.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\n{3,}", "\n\n", texte)


def points_en_millimes(brut: str) -> int:
    """« 0,8 pt » → 800. Les points sont des entiers en millièmes (ADR 0006)."""
    return round(float(brut.replace(",", ".")) * 1000)


NOMBRES = {
    "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4,
    "cinq": 5, "six": 6, "sept": 7, "huit": 8,
}


def nombre_écrit(label: str) -> int | None:
    """« Trois arguments attendus » → 3."""
    premier = label.strip().split(" ")[0].lower()
    return NOMBRES.get(premier)


def decouper_corrige(texte: str) -> dict[int, dict]:
    """
    Découpe le corrigé en questions.

    Le corrigé décompose déjà chaque QROC en éléments valués — « Définitions
    attendues (0,75 pt) », « Exemples attendus (0,5 pt) ». C'est exactement la
    structure d'un barème Coteris, et c'est ce qui rend ce jeu utilisable.
    """
    questions: dict[int, dict] = {}
    blocs = re.split(r"\nQuestion\s+(\d+)\.\s*\t?\s*\((\d+(?:[,.]\d+)?)\s*pts?\)", texte)

    # blocs[0] est le préambule ; ensuite (numéro, points, corps) par triplet.
    for i in range(1, len(blocs) - 2, 3):
        numero = int(blocs[i])
        points = points_en_millimes(blocs[i + 1])
        corps = blocs[i + 2]

        enonce = corps.split("\n")[0].strip()
        if not enonce:
            lignes = [l.strip() for l in corps.split("\n") if l.strip()]
            enonce = lignes[0] if lignes else ""

        bonne = None
        m = re.search(r"Bonne réponse\s*:\s*([^\n.]+)", corps)
        if m:
            bonne = m.group(1).strip()

        # Options QCM cochées.
        cochees = re.findall(r"☑\s*([A-E])\.", corps)

        # Éléments valués : « Quelque chose (0,75 pt) : … ».
        #
        # Le « : » peut être séparé de la parenthèse par une incise —
        # « (0,5 pt chacun, soit 1,5 pt) — accepter toute combinaison parmi : ».
        # Exiger les deux collés faisait perdre les barèmes les plus détaillés,
        # c'est-à-dire précisément les questions qui nous intéressent.
        elements = []
        for label, valeur, chacun in re.findall(
            r"([A-ZÉÈÀÇa-z][^\n(]{3,90}?)\s*"
            r"\((\d+(?:[,.]\d+)?)\s*pts?(\s+chacun)?[^)]*\)"
            r"[^\n:]{0,60}:",
            corps,
        ):
            label = label.strip(" •—-\t")
            if label.lower().startswith("question") or "bonne réponse" in label.lower():
                continue

            unitaire = points_en_millimes(valeur)

            if chacun:
                # « Trois arguments attendus (0,5 pt chacun) » : c'est une
                # attribution par élément, que le moteur Coteris gère nativement.
                nb = nombre_écrit(label) or 3
                elements.append(
                    {
                        "label": label,
                        "maxPoints": unitaire * nb,
                        "parÉlément": unitaire,
                        "nbÉléments": nb,
                    }
                )
            else:
                elements.append({"label": label, "maxPoints": unitaire})

        questions[numero] = {
            "numero": numero,
            "maxPoints": points,
            "enonce": enonce,
            "bonneReponse": bonne,
            "optionsCochees": cochees,
            "elements": elements,
            "corps": corps.strip(),
        }

    return questions


# --- Lecture des copies -------------------------------------------------------


def normaliser(texte: str) -> str:
    texte = texte.replace(" ", " ")
    texte = re.sub(r"[ \t]+", " ", texte)
    return texte.strip()


def extraire_reponse(page_texte: str) -> str | None:
    """
    Extrait la réponse de l'étudiant depuis l'historique Moodle.

    La réponse figure après « Enregistré : » dans un tableau, donc découpée sur
    plusieurs lignes et entrelacée avec les colonnes date et état. On repart du
    marqueur et on s'arrête à la ligne qui annonce la fin de la tentative.
    """
    depart = page_texte.find("Enregistré :")
    if depart == -1:
        return None

    reste = page_texte[depart + len("Enregistré :") :]
    lignes = []
    for ligne in reste.split("\n"):
        if re.search(r"Tentative terminée|Terminé\s+[\d,]", ligne):
            break

        # Colonnes parasites du tableau Moodle, retirées dans cet ordre précis :
        # la date d'abord, sinon le retrait du numéro d'étape en tête laisse
        # traîner un « juil. 26, » orphelin au milieu de la réponse — ce qui
        # polluerait silencieusement toutes les transcriptions.
        ligne = re.sub(r"\d{1,2}\s+\w{3,4}\.?\s+\d{2},?", " ", ligne)
        ligne = re.sub(r"\b\w{3,4}\.\s+\d{2},", " ", ligne)
        ligne = re.sub(r"\d{1,2}:\d{2}:\d{2}", " ", ligne)
        ligne = re.sub(r"^\s*\d+\s+", "", ligne)
        ligne = re.sub(r"\b(Réponse|enregistrée|Commencé|Pas encore|répondu)\b", "", ligne)
        if ligne.strip():
            lignes.append(ligne.strip())

    reponse = " ".join(lignes)

    # Dernier filet : un mois abrégé isolé, resté d'une date dont le jour et
    # l'année ont été retirés séparément. Il faut le point : « mai » sans point
    # est un mot français ordinaire, « juil. » ne l'est pas.
    reponse = re.sub(
        r"\b(janv|févr|fév|mars|avr|juin|juil|août|sept|oct|nov|déc)\.\s*\d{0,2},?\s*",
        " ",
        reponse,
    )

    return normaliser(reponse) or None


NOTE = re.compile(r"Note\s*:\s*(\d+(?:[,.]\d+)?)\s*/\s*(\d+(?:[,.]\d+)?)")
COMMENTAIRE = re.compile(r"Correction\s*:\s*(.+?)(?=\nNote\s*:|\nHistorique)", re.S)


def lire_corrections(chemin: Path) -> dict[int, dict]:
    """
    Extrait les décisions du correcteur d'une copie corrigée.

    Les notes sont données **par question**, pas par critère. On les prend telles
    quelles : répartir une note globale entre les critères serait une invention,
    et cette invention deviendrait la référence à laquelle on compare le système.
    """
    décisions: dict[int, dict] = {}
    entete = re.compile(r"Question (\d+)\.\s*\((\d+(?:[,.]\d+)?) pts?\)")

    with pdfplumber.open(chemin) as pdf:
        for page in pdf.pages:
            texte = page.extract_text() or ""
            marques = list(entete.finditer(texte))
            for i, m in enumerate(marques):
                fin = marques[i + 1].start() if i + 1 < len(marques) else len(texte)
                bloc = texte[m.start() : fin]
                n = NOTE.search(bloc)
                if not n:
                    continue
                c = COMMENTAIRE.search(bloc)
                décisions[int(m.group(1))] = {
                    "obtenu": points_en_millimes(n.group(1)),
                    "bareme": points_en_millimes(n.group(2)),
                    "commentaire": normaliser(c.group(1)) if c else "",
                }
    return décisions


def lire_copie(chemin: Path) -> dict[int, dict]:
    """
    Extrait les réponses d'une copie.

    Une page peut contenir **plusieurs** questions : ne prendre que la première
    correspondance faisait disparaître Q5, présente en bas de la page de Q4. On
    découpe donc la page à chaque en-tête de question.
    """
    reponses: dict[int, dict] = {}
    entete = re.compile(r"Question (\d+)\.\s*\((\d+(?:[,.]\d+)?) pts?\)")

    with pdfplumber.open(chemin) as pdf:
        for page in pdf.pages:
            texte = page.extract_text() or ""
            marques = list(entete.finditer(texte))

            for i, m in enumerate(marques):
                debut = m.start()
                fin = marques[i + 1].start() if i + 1 < len(marques) else len(texte)
                bloc = texte[debut:fin]

                numero = int(m.group(1))
                reponse = extraire_reponse(bloc) or ""

                # Une question répartie sur deux pages : on garde la version la
                # plus complète plutôt que d'écraser avec un fragment.
                ancienne = reponses.get(numero, {}).get("reponse", "")
                if numero in reponses and len(ancienne) >= len(reponse):
                    continue

                reponses[numero] = {
                    "maxPoints": points_en_millimes(m.group(2)),
                    "reponse": reponse,
                }

    return reponses


# --- Assemblage ---------------------------------------------------------------


def formulations_acceptables(corps: str) -> list[str]:
    """
    Extrait du corrigé les formulations qu'un étalon lexical peut chercher.

    On prend le début de chaque puce d'attendu — en général le concept clé —
    plutôt que la puce entière, qu'une réponse d'étudiant ne reproduira jamais
    mot pour mot.

    Cet étalon reste rudimentaire. Son intérêt n'est pas d'être bon, mais d'être
    **équitablement** rudimentaire : un étalon privé de vocabulaire donnerait un
    zéro qui flatterait n'importe quel vrai fournisseur par comparaison.
    """
    formulations: list[str] = []

    for puce in re.findall(r"•\s*([^\n]{10,300})", corps):
        puce = puce.strip()
        # « Argument SÉCURITÉ : la maintenance… » → on garde ce qui suit le « : ».
        if " : " in puce:
            puce = puce.split(" : ", 1)[1]
        # Première proposition, tronquée à quelques mots.
        segment = re.split(r"[.;(]", puce)[0].strip()
        mots = segment.split()
        if 2 <= len(mots) <= 8:
            formulations.append(" ".join(mots))
        elif len(mots) > 8:
            formulations.append(" ".join(mots[:6]))

    # Termes en capitales du corrigé : PODC, PDCA, DMS, Donabedian…
    for sigle in re.findall(r"\b([A-ZÉÈÀ]{3,12})\b", corps):
        if sigle not in {"QROC", "EXERCICE", "QCM", "TOTAL"} and sigle not in formulations:
            formulations.append(sigle)

    # Dédoublonnage en conservant l'ordre.
    vus: set[str] = set()
    uniques = []
    for f in formulations:
        clé = f.lower()
        if clé not in vus:
            vus.add(clé)
            uniques.append(f)

    return uniques[:25]


def identifiant(*parties: str) -> str:
    brut = "-".join(parties)
    brut = unicodedata.normalize("NFD", brut)
    brut = "".join(c for c in brut if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-zA-Z0-9]+", "-", brut).strip("-").lower()[:64]


def construire(
    copies_dir: Path, corrige_path: Path, corrections_dir: Path | None
) -> tuple[dict, list[dict]]:
    corrige = decouper_corrige(texte_docx(corrige_path))
    fichiers = sorted(copies_dir.glob("Copie *.pdf"))

    reponses_jeu = []
    a_noter = []
    sans_note = 0

    for fichier in fichiers:
        code = identifiant(fichier.stem)

        corrections: dict[int, dict] = {}
        if corrections_dir:
            corrigee = corrections_dir / fichier.name
            if corrigee.exists():
                corrections = lire_corrections(corrigee)

        for numero, donnees in sorted(lire_copie(fichier).items()):
            reference = corrige.get(numero)
            if reference is None:
                continue

            elements = reference["elements"]
            if not elements:
                # QCM : un seul critère, la bonne option.
                libelle = reference["bonneReponse"] or "Réponse correcte"
                elements = [{"label": libelle[:200], "maxPoints": reference["maxPoints"]}]

            # Le total des critères doit faire le barème de la question.
            somme = sum(e["maxPoints"] for e in elements)
            if somme != reference["maxPoints"] and elements:
                elements[-1]["maxPoints"] += reference["maxPoints"] - somme
                if elements[-1]["maxPoints"] < 0:
                    elements = [
                        {"label": "Réponse attendue", "maxPoints": reference["maxPoints"]}
                    ]

            vocabulaire = formulations_acceptables(reference["corps"])
            criteres = [
                {
                    "id": identifiant(f"q{numero}", e["label"][:30], str(i)),
                    "label": e["label"],
                    "maxPoints": e["maxPoints"],
                    # Vocabulaire tiré du corrigé. Sans lui, un étalon lexical ne
                    # trouve rien par construction, et le chiffre obtenu ne
                    # mesurerait que ce handicap.
                    "acceptableAnswers": vocabulaire,
                }
                for i, e in enumerate(elements)
            ]

            correction = corrections.get(numero)
            if correction is None:
                sans_note += 1

            reponses_jeu.append(
                {
                    "id": identifiant(code, f"q{numero}"),
                    "submissionId": code,
                    "questionId": f"q{numero}",
                    "question": reference["enonce"],
                    "corrigé": reference["corps"][:4000],
                    "transcriptionRéférence": donnees["reponse"],
                    # Réponses tapées : transcription parfaite par construction.
                    "origineTranscription": "saisie",
                    "critères": criteres,
                    # Le correcteur a noté la question globalement, pas critère par
                    # critère. On l'annonce plutôt que de répartir arbitrairement.
                    "niveauRéférence": "question",
                    "décisionsRéférence": [],
                    "totalRéférence": correction["obtenu"] if correction else 0,
                    "commentaireCorrecteur": correction["commentaire"] if correction else "",
                    "pointsMax": reference["maxPoints"],
                }
            )

            if correction is None:
                for critere in criteres:
                    a_noter.append(
                        {
                            "copie": code,
                            "question": f"q{numero}",
                            "critere_id": critere["id"],
                            "critere": critere["label"],
                            "points_max": critere["maxPoints"] / 1000,
                            "reponse_etudiant": donnees["reponse"][:400],
                            "etat": "",
                            "points_accordes": "",
                        }
                    )

    noté = len(reponses_jeu) - sans_note
    jeu = {
        "version": 1,
        "description": (
            "GSS4408 EC1 — Gestion d'un service de santé. "
            f"{len(fichiers)} copies, réponses saisies, "
            f"{noté}/{len(reponses_jeu)} réponses notées par un correcteur humain. "
            "Références au niveau de la question."
        ),
        "réponses": reponses_jeu,
    }

    return jeu, a_noter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--copies", required=True)
    parser.add_argument("--corrige", required=True)
    parser.add_argument("--corrections", default=None,
                        help="Répertoire des copies corrigées, portant les notes du correcteur")
    parser.add_argument("--sortie", required=True)
    parser.add_argument("--feuille", required=True)
    args = parser.parse_args()

    jeu, a_noter = construire(
        Path(args.copies),
        Path(args.corrige),
        Path(args.corrections) if args.corrections else None,
    )

    Path(args.sortie).write_text(
        json.dumps(jeu, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    with open(args.feuille, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "copie",
                "question",
                "critere_id",
                "critere",
                "points_max",
                "reponse_etudiant",
                "etat",
                "points_accordes",
            ],
            delimiter=";",
        )
        writer.writeheader()
        writer.writerows(a_noter)

    copies = len({r["submissionId"] for r in jeu["réponses"]})
    questions = len({r["questionId"] for r in jeu["réponses"]})
    vides = sum(1 for r in jeu["réponses"] if not r["transcriptionRéférence"])

    notées = sum(1 for r in jeu["réponses"] if r["commentaireCorrecteur"] or r["totalRéférence"])
    obtenu = sum(r["totalRéférence"] for r in jeu["réponses"])
    bareme = sum(r["pointsMax"] for r in jeu["réponses"])

    print(f"\nJeu écrit    : {args.sortie}")
    print(f"  copies     : {copies}")
    print(f"  questions  : {questions}")
    print(f"  réponses   : {len(jeu['réponses'])}  (dont {vides} sans réponse d'étudiant)")
    print(f"  notées     : {notées} par un correcteur humain")
    print(f"  moyenne    : {obtenu / copies / 1000:.2f} / {bareme / copies / 1000:.0f}")
    print("\n  Références au niveau de la QUESTION : le correcteur n'a pas détaillé par")
    print("  critère. Répartir une note globale entre les critères serait une invention,")
    print("  et cette invention deviendrait la référence. On s'en abstient.")

    if a_noter:
        print(f"\nFeuille de notation : {args.feuille}  ({len(a_noter)} critères sans décision)")
        print("  À remplir : colonnes « etat » (present/partial/absent) et « points_accordes ».")
    else:
        print("\nToutes les réponses sont notées : aucune feuille à remplir.")


if __name__ == "__main__":
    main()
