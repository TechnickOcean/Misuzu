import { int, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const workspacesTable = sqliteTable("workspaces_table", {
  id: int().primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  path: text().notNull(),
  store: text({ mode: "json" })
})
