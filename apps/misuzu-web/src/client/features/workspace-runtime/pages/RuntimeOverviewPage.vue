<script setup lang="ts">
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import PlatformPluginForm from "@/features/workspace-runtime/components/PlatformPluginForm.vue"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import EmptyPlaceholder from "@/components/ui/empty-placeholder/EmptyPlaceholder.vue"
import { useRuntimeOverviewPage } from "@/features/workspace-runtime/composables/use-runtime-overview-page.ts"

const props = defineProps<{
  workspaceId: string
}>()

const {
  snapshot,
  loading,
  activeChallenges,
  queuedChallenges,
  historyChallenges,
  selectedPluginId,
  pluginDraft,
  initError,
  queueActionChallengeId,
  queueActionError,
  initializeRuntime,
  openSolverAgent,
  badgeVariantForStatus,
  enqueueChallenge,
  dequeueChallenge,
  resetSolver,
} = useRuntimeOverviewPage(props.workspaceId)
</script>

<template>
  <div class="grid gap-4">
    <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Challenges</CardDescription>
          <CardTitle class="text-2xl">{{ snapshot?.challenges.length ?? 0 }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Pending</CardDescription>
          <CardTitle class="text-2xl">{{ snapshot?.queue.pendingTaskCount ?? 0 }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Busy Solvers</CardDescription>
          <CardTitle class="text-2xl">{{ snapshot?.queue.busySolverCount ?? 0 }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Idle Solvers</CardDescription>
          <CardTitle class="text-2xl">{{ snapshot?.queue.idleSolverCount ?? 0 }}</CardTitle>
        </CardHeader>
      </Card>
    </section>

    <Card v-if="snapshot && !snapshot.initialized">
      <CardHeader>
        <CardTitle>Initialize Runtime Plugin</CardTitle>
        <CardDescription>
          Runtime is in no-plugin mode. Configure adapter credentials below and bootstrap platform
          sync.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <PlatformPluginForm v-model:plugin-id="selectedPluginId" :plugin-draft="pluginDraft" />

        <div class="flex items-center gap-2">
          <Button @click="initializeRuntime">Initialize Runtime</Button>
          <p v-if="initError" class="text-sm text-destructive">{{ initError }}</p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Challenge Queue</CardTitle>
        <CardDescription>
          Ordered as active first, queued (collapsed), then solved/blocked history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <section v-if="activeChallenges.length" class="space-y-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Active
            </p>
            <article
              v-for="challenge in activeChallenges"
              :key="challenge.challengeId"
              class="rounded-md border p-3"
            >
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 class="font-medium">#{{ challenge.challengeId }} {{ challenge.title }}</h4>
                  <p class="text-xs text-muted-foreground">
                    {{ challenge.category }} · {{ challenge.score }} pts · solved
                    {{ challenge.solvedCount }}
                    <template v-if="typeof challenge.rank === 'number'">
                      · rank {{ Math.round(challenge.rank) }}
                    </template>
                  </p>
                </div>
                <Badge :variant="badgeVariantForStatus(challenge.status)">
                  {{ challenge.status }}
                </Badge>
              </div>

              <Separator class="my-3" />

              <div class="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  :disabled="queueActionChallengeId === challenge.challengeId"
                  @click="enqueueChallenge(challenge.challengeId)"
                >
                  Enqueue
                </Button>
                <Button
                  variant="outline"
                  :disabled="queueActionChallengeId === challenge.challengeId"
                  @click="dequeueChallenge(challenge.challengeId)"
                >
                  Dequeue
                </Button>
                <Button
                  variant="ghost"
                  :disabled="queueActionChallengeId === challenge.challengeId"
                  @click="resetSolver(challenge.challengeId)"
                >
                  Reset Solver
                </Button>
                <Button
                  v-if="challenge.status !== 'model_unassigned'"
                  variant="secondary"
                  @click="openSolverAgent(challenge.solverId)"
                >
                  Open {{ challenge.solverId }}
                </Button>
              </div>
            </article>
          </section>

          <details v-if="queuedChallenges.length" class="rounded-md border p-3">
            <summary class="cursor-pointer text-xs font-semibold uppercase tracking-wide">
              Queued ({{ queuedChallenges.length }})
            </summary>
            <div class="mt-3 grid gap-2">
              <article
                v-for="challenge in queuedChallenges"
                :key="challenge.challengeId"
                class="rounded-md border p-3"
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 class="font-medium">#{{ challenge.challengeId }} {{ challenge.title }}</h4>
                    <p class="text-xs text-muted-foreground">
                      {{ challenge.category }} · {{ challenge.score }} pts · solved
                      {{ challenge.solvedCount }}
                      <template v-if="typeof challenge.rank === 'number'">
                        · rank {{ Math.round(challenge.rank) }}
                      </template>
                    </p>
                  </div>
                  <Badge :variant="badgeVariantForStatus(challenge.status)">
                    {{ challenge.status }}
                  </Badge>
                </div>

                <Separator class="my-3" />

                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    :disabled="queueActionChallengeId === challenge.challengeId"
                    @click="enqueueChallenge(challenge.challengeId)"
                  >
                    Enqueue
                  </Button>
                  <Button
                    variant="outline"
                    :disabled="queueActionChallengeId === challenge.challengeId"
                    @click="dequeueChallenge(challenge.challengeId)"
                  >
                    Dequeue
                  </Button>
                  <Button
                    variant="ghost"
                    :disabled="queueActionChallengeId === challenge.challengeId"
                    @click="resetSolver(challenge.challengeId)"
                  >
                    Reset Solver
                  </Button>
                  <Button
                    variant="secondary"
                    :disabled="challenge.status === 'model_unassigned'"
                    @click="openSolverAgent(challenge.solverId)"
                  >
                    Open {{ challenge.solverId }}
                  </Button>
                </div>
              </article>
            </div>
          </details>

          <section v-if="historyChallenges.length" class="space-y-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Solved / Blocked
            </p>
            <article
              v-for="challenge in historyChallenges"
              :key="challenge.challengeId"
              class="rounded-md border p-3"
            >
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 class="font-medium">#{{ challenge.challengeId }} {{ challenge.title }}</h4>
                  <p class="text-xs text-muted-foreground">
                    {{ challenge.category }} · {{ challenge.score }} pts · solved
                    {{ challenge.solvedCount }}
                    <template v-if="typeof challenge.rank === 'number'">
                      · rank {{ Math.round(challenge.rank) }}
                    </template>
                  </p>
                  <p v-if="challenge.statusReason" class="text-xs text-muted-foreground">
                    {{ challenge.statusReason }}
                  </p>
                </div>
                <Badge :variant="badgeVariantForStatus(challenge.status)">
                  {{ challenge.status }}
                </Badge>
              </div>

              <Separator class="my-3" />

              <div class="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  :disabled="queueActionChallengeId === challenge.challengeId"
                  @click="enqueueChallenge(challenge.challengeId)"
                >
                  Enqueue
                </Button>
                <Button
                  variant="outline"
                  :disabled="queueActionChallengeId === challenge.challengeId"
                  @click="dequeueChallenge(challenge.challengeId)"
                >
                  Dequeue
                </Button>
                <Button
                  variant="ghost"
                  :disabled="queueActionChallengeId === challenge.challengeId"
                  @click="resetSolver(challenge.challengeId)"
                >
                  Reset Solver
                </Button>
                <Button
                  v-if="challenge.status !== 'model_unassigned'"
                  variant="secondary"
                  @click="openSolverAgent(challenge.solverId)"
                >
                  Open {{ challenge.solverId }}
                </Button>
              </div>
            </article>
          </section>

          <div v-if="loading" class="space-y-4 py-2">
            <Skeleton class="h-24 w-full rounded-md" />
            <Skeleton class="h-24 w-full rounded-md" />
          </div>

          <EmptyPlaceholder
            v-else-if="(snapshot?.challenges.length ?? 0) === 0"
            title="No challenges"
            description="No challenges loaded yet. Run challenge sync first."
          />

          <p v-if="queueActionError" class="text-sm text-destructive">{{ queueActionError }}</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
