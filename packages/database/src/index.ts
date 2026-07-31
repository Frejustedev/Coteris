/**
 * @coteris/database — schéma, connexion et accès aux données.
 */

export * from './schema/index'
export { createDatabase, db, schema, type Database, type DatabaseOptions } from './client'
