import { randomBytes } from "node:crypto"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/libsql"
import sanitize from "sanitize-filename"
import { TMP_DIR } from "@/consts"
import { AppError } from "@/utils/errors"
import { workspacesTable } from "./schema"

const db = drizzle({
  connection: {
    url: pathToFileURL(resolve(`E:/dev/Misuzu/.data/workspaces.sqlite`)).href
  }
})

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
  throw new AppError("NOT_FOUND", "Workspace not found", { id })
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

export async function listDBWorkspaces() {
  return await db.select().from(workspacesTable)
}
