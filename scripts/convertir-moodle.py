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


ENTETE_QUESTION = re.compile(r"Question (\d+)\.\s*\((\d+(?:[,.]\d+)?) pts?\)")

# Valeurs de la colonne « Action » qui CLÔTURENT une version enregistrée.
# Comparaison exacte, jamais par préfixe : une ligne de prose d'étudiant
# commençant par « Vu » ne doit pas interrompre sa propre réponse.
ACTIONS_DE_CLOTURE = frozenset(
    {
        "Commencé",
        "Tentative terminée",
        "Aperçu",
        "Vu",
        "Terminé",
        "Rétabli",
        "Recommencé",
        "Pas encore répondu",
    }
)


def lignes_par_ordonnee(page, tolerance: float = 3.0) -> list[list[dict]]:
    """
    Regroupe les mots d'une page en lignes, par ordonnée.

    On travaille sur les coordonnées et non sur `extract_text()`, parce que
    l'historique Moodle est un TABLEAU à cinq colonnes. Restitué en texte plat,
    il entrelace les cellules de gauche au milieu de la réponse de l'étudiant, et
    tenter de les retirer ensuite par expressions régulières est une bataille
    perdue d'avance — trois correctifs successifs l'ont montré.
    """
    lignes: list[list[dict]] = []
    for mot in sorted(page.extract_words(), key=lambda m: (m["top"], m["x0"])):
        if lignes and abs(lignes[-1][0]["top"] - mot["top"]) <= tolerance:
            lignes[-1].append(mot)
        else:
            lignes.append([mot])
    return [sorted(ligne, key=lambda m: m["x0"]) for ligne in lignes]


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
    Extrait les réponses d'une copie, en lisant l'historique comme un tableau.

    DEUX CHOIX QUI CORRIGENT DES PERTES CONSTATÉES

    **La réponse est prise dans la seule colonne « Action ».** Géométrie relevée
    sur pièce : Étape à x≈115, Heure à x≈160, Action à x≈219, État à x≈464.
    Moodle écrit « Enregistré : <réponse> » dans la colonne Action, et c'est
    l'entrelacement des trois autres qui injectait un « 2 » ou un « 26, » au
    milieu de 134 transcriptions sur 208. Découper par abscisse supprime la cause
    au lieu d'en nettoyer les symptômes.

    **La question courante est conservée d'une page à l'autre.** Le découpage
    était strictement intra-page : une page sans en-tête « Question N. » était
    sautée en silence. Quand l'historique d'une question longue débordait et que
    le « Enregistré : » se trouvait en haut de la page suivante, la réponse
    disparaissait entièrement. Deux copies étaient dans ce cas — notées 1250 et
    1750 millièmes par le correcteur, pour une transcription vide.

    Les versions successives sont modélisées explicitement : une cellule
    « Enregistré : » ouvre une version, une action de clôture la ferme, et on
    retient la DERNIÈRE. L'ancienne règle du « plus long gagne » choisissait par
    longueur brute et non par complétude.
    """
    reponses: dict[int, dict] = {}
    courante: int | None = None
    x_action: float | None = None
    x_etat: float | None = None

    def cloturer(numero: int) -> None:
        bloc = reponses[numero]
        if bloc["encours"] is not None:
            version = normaliser(" ".join(bloc["encours"]))
            if version:
                bloc["versions"].append(version)
            bloc["encours"] = None

    with pdfplumber.open(chemin) as pdf:
        for page in pdf.pages:
            for ligne in lignes_par_ordonnee(page):
                texte = " ".join(m["text"] for m in ligne)

                marque = ENTETE_QUESTION.search(texte)
                if marque:
                    if courante is not None:
                        cloturer(courante)
                    courante = int(marque.group(1))
                    reponses.setdefault(
                        courante,
                        {
                            "maxPoints": points_en_millimes(marque.group(2)),
                            "versions": [],
                            "encours": None,
                            "nonRepondue": False,
                        },
                    )
                    # Nouveau bloc : la géométrie du tableau précédent ne vaut plus.
                    x_action = x_etat = None
                    continue

                if courante is None:
                    continue

                # L'état de la barre latérale départage une vraie copie blanche
                # d'une réponse perdue à l'extraction. C'est sur lui que porte
                # l'assertion de fin de conversion.
                if "Non répondue" in texte:
                    reponses[courante]["nonRepondue"] = True

                # En-tête du tableau d'historique : fixe la géométrie des colonnes.
                # Il se répète en haut de chaque page de débordement, ce qui
                # rétablit la géométrie sans qu'on ait à la deviner.
                abscisses = {m["text"]: m["x0"] for m in ligne}
                if "Action" in abscisses and "État" in abscisses and "Étape" in abscisses:
                    x_action, x_etat = abscisses["Action"], abscisses["État"]
                    continue

                if x_action is None or x_etat is None:
                    continue

                cellule = " ".join(
                    m["text"] for m in ligne if x_action - 2 <= m["x0"] < x_etat - 2
                ).strip()
                if not cellule:
                    continue

                bloc = reponses[courante]
                if cellule.startswith("Enregistré"):
                    cloturer(courante)
                    _, _, contenu = cellule.partition(":")
                    bloc["encours"] = [contenu.strip()]
                elif cellule in ACTIONS_DE_CLOTURE:
                    cloturer(courante)
                elif bloc["encours"] is not None:
                    bloc["encours"].append(cellule)

    if courante is not None:
        cloturer(courante)

    return {
        numero: {
            "maxPoints": bloc["maxPoints"],
            # La dernière version enregistrée est l'état final de la copie, ce
            # que confirme l'étiquette « v1 (dernière) » du PDF.
            "reponse": bloc["versions"][-1] if bloc["versions"] else "",
            "versions": len(bloc["versions"]),
            "nonRepondue": bloc["nonRepondue"],
        }
        for numero, bloc in reponses.items()
    }


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
    incoherences: list[str] = []

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

            # Deux contradictions qui trahissent une perte à l'extraction.
            #
            # Elles ne sont pas des avertissements : elles font échouer la
            # conversion. Les deux réponses perdues par la version précédente ont
            # traversé tout le pipeline, ont été écrites dans le jeu, comptées
            # dans « dont N sans réponse d'étudiant », puis publiées — sans
            # qu'aucun signal ne soit émis. La contradiction « transcription vide
            # + note non nulle » était détectable en une ligne dès la première
            # exécution.
            if not donnees["reponse"]:
                if correction and correction["obtenu"] > 0:
                    incoherences.append(
                        f"{code}/q{numero} : transcription vide alors que le correcteur a "
                        f"accordé {correction['obtenu'] / 1000:.2f} point(s). La réponse a "
                        f"été perdue à l'extraction."
                    )
                elif not donnees["nonRepondue"]:
                    incoherences.append(
                        f"{code}/q{numero} : transcription vide sans état « Non répondue » "
                        f"dans le PDF. Une vraie copie blanche porte cet état ; son absence "
                        f"signale une perte."
                    )

            reponses_jeu.append(
                {
                    "id": identifiant(code, f"q{numero}"),
                    "submissionId": code,
                    "questionId": f"q{numero}",
                    "question": reference["enonce"],
                    "corrigé": reference["corps"][:4000],
                    "transcriptionRéférence": donnees["reponse"],
                    # Réponses tapées par l'étudiant dans Moodle : aucune
                    # incertitude de LECTURE. La fidélité de l'EXTRACTION, elle,
                    # n'est pas acquise par construction — elle est garantie par
                    # la lecture en colonnes et par les assertions de fin de
                    # conversion, pas par la nature de la source.
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

    if incoherences:
        raise SystemExit(
            "\nCONVERSION ABANDONNÉE — "
            f"{len(incoherences)} transcription(s) vide(s) suspecte(s) :\n\n"
            + "\n".join(f"  · {i}" for i in incoherences)
            + "\n\nUn jeu d'évaluation corrompu produit des chiffres faux mais crédibles.\n"
            "  Corrigez l'extraction avant de régénérer le jeu ; n'écrivez rien de partiel.\n"
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
