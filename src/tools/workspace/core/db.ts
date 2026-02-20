import "dotenv/config"
import { Database } from "bun:sqlite"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sqlite"
import sanitize from "sanitize-filename"
import { TMP_DIR } from "@/consts"
import { workspacesTable } from "./schema"

const sqlite = new Database(process.env.DB_FILE_NAME!, { create: true })
const db = drizzle({ client: sqlite })

function randomChars(byte: number) {
  return randomBytes(byte).toHex()
}

export async function createDBWorkspace({ title }: { title: string }) {
  const random_path = join(TMP_DIR, `${sanitize(title)}-${randomChars(4)}`)
  return await db
    .insert(workspacesTable)
    .values({
      title,
      path: random_path
    })
    .returning()
}

export async function getDBWorkspace({ id }: { id: number }) {
  const result = await db.select().from(workspacesTable).where(eq(workspacesTable.id, id))
  if (result.length > 0) return result[0]
  else throw "Not Found"
}

export async function updateDBWorkspace({
  id,
  data
}: {
  id: number
  data: Partial<typeof workspacesTable.$inferInsert>
}) {
  return await db.update(workspacesTable).set(data).where(eq(workspacesTable.id, id)).returning()
}
