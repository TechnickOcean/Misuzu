import { exec } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { promisify } from "node:util"
import { Octokit } from "@octokit/rest"
import { z } from "zod"
import { AppError } from "@/utils/errors"
import BaseFunctionTool from "../base/FunctionTool"

const execAsync = promisify(exec)

const repoSearchItemSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  html_url: z.string(),
  stargazers_count: z.number(),
  language: z.string().nullable(),
  updated_at: z.string()
})

const repoSearchResponseSchema = z.object({
  items: z.array(repoSearchItemSchema)
})

const codeSearchItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  repository: z.object({
    full_name: z.string(),
    html_url: z.string()
  }),
  html_url: z.string(),
  score: z.number()
})

const codeSearchResponseSchema = z.object({
  items: z.array(codeSearchItemSchema)
})

const releaseInfoSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  published_at: z.string().nullable(),
  zipball_url: z.string().nullable(),
  tarball_url: z.string().nullable(),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.string()
    })
  )
})

const releaseListSchema = z.array(releaseInfoSchema)

const securityAdvisorySchema = z.object({
  ghsa_id: z.string(),
  cve_id: z.string().nullable(),
  summary: z.string(),
  description: z.string().nullable(),
  severity: z.string().nullable(),
  state: z.string(),
  published_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  html_url: z.string()
})

const securityAdvisoryListSchema = z.array(securityAdvisorySchema)

export type SearchResultRepo = z.infer<typeof repoSearchItemSchema>
export type SearchResultCode = z.infer<typeof codeSearchItemSchema>
export type ReleaseInfo = z.infer<typeof releaseInfoSchema>
export type SecurityAdvisory = z.infer<typeof securityAdvisorySchema>
export type FileContent = {
  name: string
  path: string
  content: string // Decoded content
  encoding: string
  download_url: string | null
}

export const SearchRepoSchema = z.object({
  query: z.string().min(1).describe("Keywords to search for repositories"),
  language: z.string().optional().describe("Filter by programming language (e.g. 'python', 'javascript')"),
  limit: z.number().min(1).max(100).default(10).describe("Max number of results to return")
})

export const SearchCodeSchema = z.object({
  query: z.string().min(1).describe("Code snippet or keywords to search for inside files"),
  language: z.string().optional().describe("Filter by programming language"),
  limit: z.number().min(1).max(100).default(10).describe("Max number of results to return")
})

export const GetContentSchema = z.object({
  owner: z.string().describe("Repository owner (username or org)"),
  repo: z.string().describe("Repository name"),
  path: z.string().default("").describe("File path within the repository")
})

export const ListReleasesSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  limit: z.number().default(5).describe("Number of releases to list")
})

export const DownloadReleaseSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  ref: z.string().describe("Tag name, branch, or commit hash to download/clone"),
  destPath: z.string().describe("Absolute path where the code should be downloaded/cloned")
})

export const ListSecurityAdvisoriesSchema = z.object({
  owner: z.string().describe("Repository owner"),
  repo: z.string().describe("Repository name"),
  limit: z.number().default(5).describe("Number of advisories to list")
})

export class GitHubSearch {
  private octokit: Octokit
  private token: string | undefined

  constructor(token?: string) {
    this.token = token || process.env.GITHUB_TOKEN
    if (!this.token) {
      // no-op
    }
    this.octokit = new Octokit({
      auth: this.token,
      userAgent: "AgentHiro-CTF-Tool/1.0"
    })
  }

  async searchRepositories(
    query: string,
    options?: { language?: string; limit?: number }
  ): Promise<SearchResultRepo[]> {
    const q = options?.language ? `${query} language:${options.language}` : query
    try {
      const response = await this.octokit.rest.search.repos({
        q,
        per_page: options?.limit || 10,
        sort: "stars",
        order: "desc"
      })

      const parsed = repoSearchResponseSchema.parse(response.data)
      return parsed.items
    } catch {
      throw new AppError("UPSTREAM_ERROR", "GitHub repository search failed", {
        query: q
      })
    }
  }

  async searchCode(query: string, options?: { language?: string; limit?: number }): Promise<SearchResultCode[]> {
    const q = options?.language ? `${query} language:${options.language}` : query
    try {
      const response = await this.octokit.rest.search.code({
        q,
        per_page: options?.limit || 10,
        sort: "indexed"
      })

      const parsed = codeSearchResponseSchema.parse(response.data)
      return parsed.items
    } catch {
      throw new AppError("UPSTREAM_ERROR", "GitHub code search failed", {
        query: q
      })
    }
  }

  async getRepoContent(owner: string, repo: string, path: string = ""): Promise<FileContent> {
    try {
      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path
      })

      if (Array.isArray(response.data)) {
        throw new AppError("NOT_FOUND", "Path points to a directory, not a file", { owner, repo, path })
      }

      if (!("content" in response.data)) {
        throw new AppError("UPSTREAM_ERROR", "Response is not a file content", { owner, repo, path })
      }

      const content = Buffer.from(response.data.content, "base64").toString("utf-8")

      return {
        name: response.data.name,
        path: response.data.path,
        content: content,
        encoding: response.data.encoding,
        download_url: response.data.download_url
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError("UPSTREAM_ERROR", "GitHub content fetch failed", { owner, repo, path })
    }
  }

  async listReleases(owner: string, repo: string, limit: number = 5): Promise<ReleaseInfo[]> {
    try {
      const response = await this.octokit.rest.repos.listReleases({
        owner,
        repo,
        per_page: limit
      })

      return releaseListSchema.parse(response.data)
    } catch {
      throw new AppError("UPSTREAM_ERROR", "GitHub release list failed", { owner, repo })
    }
  }

  async listSecurityAdvisories(owner: string, repo: string, limit: number = 5): Promise<SecurityAdvisory[]> {
    try {
      const response = await this.octokit.request("GET /repos/{owner}/{repo}/security-advisories", {
        owner,
        repo,
        per_page: limit,
        state: "published",
        headers: {
          "X-GitHub-Api-Version": "2022-11-28"
        }
      })

      return securityAdvisoryListSchema.parse(response.data)
    } catch {
      throw new AppError("UPSTREAM_ERROR", "GitHub advisory list failed", { owner, repo })
    }
  }

  /**
   * Clone a repository (optionally at a specific tag/branch) for local auditing.
   * This is crucial for 0-day auditing where you need the full context.
   */
  async cloneRepository(owner: string, repo: string, destPath: string, ref?: string): Promise<string> {
    const repoUrl = `https://github.com/${owner}/${repo}.git`

    const parentDir = path.dirname(destPath)
    if (!fs.existsSync(parentDir)) {
      await fs.promises.mkdir(parentDir, { recursive: true })
    }

    let command = `git clone "${repoUrl}" "${destPath}"`

    if (ref) {
      command = `git clone "${repoUrl}" "${destPath}" && cd "${destPath}" && git checkout "${ref}"`
    }

    try {
      await execAsync(command)
      return destPath
    } catch {
      throw new AppError("UPSTREAM_ERROR", "Git clone failed", { owner, repo, destPath, ref })
    }
  }
}

// --- Function Tool Exports ---

const gitHubToolInstance = new GitHubSearch()

export const ghSearchRepos = new BaseFunctionTool({
  name: "github_search_repos",
  description: "Search GitHub repositories for tools, exploits, or specific projects.",
  schema: SearchRepoSchema,
  func: async (args) => {
    return gitHubToolInstance.searchRepositories(args.query, {
      language: args.language,
      limit: args.limit
    })
  }
})

export const ghSearchCode = new BaseFunctionTool({
  name: "github_search_code",
  description: "Search for specific code snippets, function calls, or file contents across GitHub.",
  schema: SearchCodeSchema,
  func: async (args) => {
    return gitHubToolInstance.searchCode(args.query, {
      language: args.language,
      limit: args.limit
    })
  }
})

export const ghGetContent = new BaseFunctionTool({
  name: "github_get_content",
  description: "Read the content of a file from a GitHub repository.",
  schema: GetContentSchema,
  func: async (args) => {
    return gitHubToolInstance.getRepoContent(args.owner, args.repo, args.path)
  }
})

export const ghListReleases = new BaseFunctionTool({
  name: "github_list_releases",
  description: "List releases/tags of a repository to find versions.",
  schema: ListReleasesSchema,
  func: async (args) => {
    return gitHubToolInstance.listReleases(args.owner, args.repo, args.limit)
  }
})

export const ghDownloadRelease = new BaseFunctionTool({
  name: "github_download_release",
  description: "Clone/Download a specific version of a repository for local auditing.",
  schema: DownloadReleaseSchema,
  func: async (args) => {
    return gitHubToolInstance.cloneRepository(args.owner, args.repo, args.destPath, args.ref)
  }
})

export const ghListSecurityAdvisories = new BaseFunctionTool({
  name: "github_list_security_advisories",
  description: "List security advisories (CVEs) for a repository.",
  schema: ListSecurityAdvisoriesSchema,
  func: async (args) => {
    return gitHubToolInstance.listSecurityAdvisories(args.owner, args.repo, args.limit)
  }
})
