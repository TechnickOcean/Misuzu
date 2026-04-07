import { computed, onMounted, onUnmounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import type { PromptMode } from "@shared/protocol.ts"
import { useSolverWorkspace } from "@/features/workspace-solver/composables/use-solver-workspace.ts"

export function useSolverWorkspacePage() {
  const route = useRoute()
  const router = useRouter()

  const workspaceId = computed(() => String(route.params.id))
  const solver = useSolverWorkspace(workspaceId.value)
  const sending = ref(false)

  const snapshot = computed(() => solver.snapshot.value)
  const state = computed(() => solver.state.value)

  onMounted(async () => {
    await solver.open()
  })

  onUnmounted(() => {
    solver.disconnect()
  })

  async function sendPrompt(payload: { prompt: string; mode: PromptMode }) {
    sending.value = true
    try {
      await solver.prompt(payload.prompt, payload.mode)
    } finally {
      sending.value = false
    }
  }

  function openHome() {
    void router.push({ name: "home" })
  }

  function openCreateWorkspace() {
    void router.push({ name: "workspace-create" })
  }

  return {
    workspaceId,
    snapshot,
    state,
    sending,
    sendPrompt,
    openHome,
    openCreateWorkspace,
  }
}
