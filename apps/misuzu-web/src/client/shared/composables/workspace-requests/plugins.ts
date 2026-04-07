import { defineQuery, useQuery } from "@pinia/colada"
import { ref } from "vue"
import type { PluginCatalogItem, PluginReadmeResponse } from "@shared/protocol.ts"
import {
  normalizePluginId,
  normalizePluginQuery,
  type PluginCatalogParams,
  type PluginReadmeParams,
} from "./common.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

export const usePluginCatalogQuery = defineQuery(() => {
  const { apiClient } = useAppServices()
  const paramsRef = ref<PluginCatalogParams>({ query: "" })

  const query = useQuery({
    key: () => ["plugin-catalog", normalizePluginQuery(paramsRef.value.query)],
    query: () => apiClient.listPlugins(normalizePluginQuery(paramsRef.value.query)),
  })

  return { paramsRef, ...query }
})

export const usePluginReadmeQuery = defineQuery(() => {
  const { apiClient } = useAppServices()
  const paramsRef = ref<PluginReadmeParams>({ pluginId: "" })

  const query = useQuery({
    key: () => ["plugin-readme", normalizePluginId(paramsRef.value.pluginId)],
    enabled: () => Boolean(normalizePluginId(paramsRef.value.pluginId)),
    query: () => apiClient.getPluginReadme(normalizePluginId(paramsRef.value.pluginId)),
  })

  return { paramsRef, ...query }
})

export type PluginCatalogQuery = ReturnType<typeof usePluginCatalogQuery>
export type PluginReadmeQuery = ReturnType<typeof usePluginReadmeQuery>

export type PluginCatalogData = PluginCatalogItem[]
export type PluginReadmeData = PluginReadmeResponse
