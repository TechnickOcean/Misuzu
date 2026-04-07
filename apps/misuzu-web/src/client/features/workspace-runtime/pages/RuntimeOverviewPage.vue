<script setup lang="ts">
import { CheckIcon, ChevronsUpDownIcon } from "lucide-vue-next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxViewport,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useRuntimeOverviewPage } from "@/features/workspace-runtime/composables/use-runtime-overview-page.ts"

const props = defineProps<{
  workspaceId: string
}>()

const {
  snapshot,
  activeChallenges,
  queuedChallenges,
  historyChallenges,
  plugins,
  selectedPluginId,
  pluginReadmeHtml,
  pluginComboboxOpen,
  pluginDraft,
  initError,
  modelPoolDraft,
  modelPoolSaving,
  modelPoolError,
  providerOptions,
  selectedPlugin,
  selectedPluginLabel,
  queueActionChallengeId,
  queueActionError,
  loadPlugins,
  loadPluginReadme,
  initializeRuntime,
  openSolverAgent,
  setContestMode,
  setAuthMode,
  badgeVariantForStatus,
  syncModelPoolDraftFromSnapshot,
  addModelPoolRow,
  listModelsForProvider,
  removeModelPoolRow,
  applyModelPool,
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
        <Combobox
          v-model="selectedPluginId"
          :open="pluginComboboxOpen"
          @update:open="(value) => (pluginComboboxOpen = Boolean(value))"
        >
          <ComboboxAnchor class="w-full">
            <Button variant="outline" class="w-full justify-between font-normal" type="button">
              <span class="truncate">{{ selectedPluginLabel }}</span>
              <ChevronsUpDownIcon class="size-4 shrink-0 opacity-50" />
            </Button>
          </ComboboxAnchor>

          <ComboboxList class="w-[var(--reka-popper-anchor-width)] p-0">
            <ComboboxInput placeholder="Search plugin by name or id..." />
            <ComboboxEmpty>No plugin found.</ComboboxEmpty>

            <ComboboxViewport>
              <ComboboxGroup>
                <ComboboxItem
                  v-for="plugin in plugins"
                  :key="plugin.id"
                  :value="plugin.id"
                  class="justify-between"
                >
                  <span class="truncate">{{ plugin.name }} ({{ plugin.id }})</span>
                  <ComboboxItemIndicator>
                    <CheckIcon class="size-4" />
                  </ComboboxItemIndicator>
                </ComboboxItem>
              </ComboboxGroup>
            </ComboboxViewport>
          </ComboboxList>
        </Combobox>

        <Button variant="outline" class="w-fit" @click="loadPlugins">Refresh Plugins</Button>

        <Button
          v-if="selectedPluginId"
          variant="secondary"
          class="w-fit"
          @click="loadPluginReadme(selectedPluginId)"
        >
          Refresh README
        </Button>

        <article class="rounded-md border bg-muted/30 p-3">
          <div class="markdown-content text-sm" v-html="pluginReadmeHtml" />
        </article>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="grid gap-2 md:col-span-2">
            <label class="text-sm font-medium">Base URL</label>
            <Input v-model="pluginDraft.baseUrl" placeholder="https://ctf.example.com" />
          </div>

          <div class="grid gap-2">
            <label class="text-sm font-medium">Contest Mode</label>
            <Select :model-value="pluginDraft.contestMode" @update:model-value="setContestMode">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Select contest mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto</SelectItem>
                <SelectItem value="id">id</SelectItem>
                <SelectItem value="title">title</SelectItem>
                <SelectItem value="url">url</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div v-if="pluginDraft.contestMode !== 'auto'" class="grid gap-2">
            <label class="text-sm font-medium">Contest Value</label>
            <Input
              v-model="pluginDraft.contestValue"
              :placeholder="pluginDraft.contestMode === 'id' ? '12345' : 'contest value'"
            />
          </div>

          <div class="grid gap-2 md:col-span-2">
            <label class="text-sm font-medium">Auth Mode</label>
            <Select :model-value="pluginDraft.authMode" @update:model-value="setAuthMode">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Select auth mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">manual</SelectItem>
                <SelectItem value="credentials">credentials</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p class="text-xs text-muted-foreground md:col-span-2">
            Recommended: start with <code>manual</code> so EnvironmentAgent can assist adapter
            debugging and plugin maintenance.
          </p>

          <template v-if="pluginDraft.authMode === 'credentials'">
            <div class="grid gap-2">
              <label class="text-sm font-medium">Username</label>
              <Input v-model="pluginDraft.username" placeholder="username" />
            </div>
            <div class="grid gap-2">
              <label class="text-sm font-medium">Password</label>
              <Input v-model="pluginDraft.password" type="password" placeholder="password" />
            </div>
            <div class="grid gap-2">
              <label class="text-sm font-medium">Login URL</label>
              <Input v-model="pluginDraft.loginUrl" placeholder="https://.../login" />
            </div>
            <div class="grid gap-2">
              <label class="text-sm font-medium">Auth Check URL</label>
              <Input v-model="pluginDraft.authCheckUrl" placeholder="https://.../api/me" />
            </div>
            <div class="grid gap-2">
              <label class="text-sm font-medium">Timeout (sec)</label>
              <Input v-model="pluginDraft.timeoutSec" type="number" min="1" placeholder="120" />
            </div>
          </template>
        </div>

        <div class="flex items-center gap-2">
          <Button @click="initializeRuntime">Initialize Runtime</Button>
          <p v-if="initError" class="text-sm text-destructive">{{ initError }}</p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Model Pool</CardTitle>
        <CardDescription>
          Update model allocation while runtime flow is paused, then resume dispatch.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <article
          v-for="item in modelPoolDraft"
          :key="item.id"
          class="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_150px_auto]"
        >
          <Input
            v-model="item.provider"
            list="runtime-overview-provider-options"
            placeholder="provider"
          />
          <Input
            v-model="item.modelId"
            :list="`runtime-overview-model-options-${item.id}`"
            placeholder="model id"
          />
          <Input
            v-model="item.maxConcurrency"
            type="number"
            min="1"
            placeholder="max concurrency"
          />
          <Button variant="ghost" type="button" @click="removeModelPoolRow(item.id)">Remove</Button>

          <datalist :id="`runtime-overview-model-options-${item.id}`">
            <option
              v-for="model in listModelsForProvider(item.provider)"
              :key="model.modelId"
              :value="model.modelId"
            />
          </datalist>
        </article>

        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" type="button" @click="addModelPoolRow">Add model</Button>
          <Button
            type="button"
            :disabled="!snapshot?.paused || modelPoolSaving"
            @click="applyModelPool"
          >
            {{ modelPoolSaving ? "Updating..." : "Apply Model Pool" }}
          </Button>
          <Button variant="ghost" type="button" @click="syncModelPoolDraftFromSnapshot"
            >Reset</Button
          >
        </div>

        <p v-if="!snapshot?.paused" class="text-xs text-muted-foreground">
          Pause flow first to update model pool safely.
        </p>
        <p v-if="modelPoolError" class="text-sm text-destructive">{{ modelPoolError }}</p>
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
                  variant="secondary"
                  :disabled="challenge.status === 'model_unassigned'"
                  @click="openSolverAgent(challenge.solverId)"
                >
                  Open {{ challenge.solverId }}
                </Button>
              </div>
            </article>
          </section>

          <p v-if="(snapshot?.challenges.length ?? 0) === 0" class="text-sm text-muted-foreground">
            No challenges loaded yet. Run challenge sync first.
          </p>
          <p v-if="queueActionError" class="text-sm text-destructive">{{ queueActionError }}</p>
        </div>
      </CardContent>
    </Card>

    <datalist id="runtime-overview-provider-options">
      <option v-for="provider in providerOptions" :key="provider" :value="provider" />
    </datalist>
  </div>
</template>
