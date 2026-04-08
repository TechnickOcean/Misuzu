import { createRouter, createWebHistory } from "vue-router"
import CreateWorkspacePage from "@/features/workspace-registry/pages/CreateWorkspacePage.vue"
import WorkspaceHomePage from "@/features/workspace-registry/pages/WorkspaceHomePage.vue"
import RuntimeAgentPage from "@/features/workspace-runtime/pages/RuntimeAgentPage.vue"
import RuntimeOverviewPage from "@/features/workspace-runtime/pages/RuntimeOverviewPage.vue"
import RuntimeSettingsPage from "@/features/workspace-runtime/pages/RuntimeSettingsPage.vue"
import RuntimeWorkspaceLayoutPage from "@/features/workspace-runtime/pages/RuntimeWorkspaceLayoutPage.vue"
import SolverWorkspacePage from "@/features/workspace-solver/pages/SolverWorkspacePage.vue"

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: WorkspaceHomePage,
      meta: {
        breadcrumb: "Home",
      },
    },
    {
      path: "/workspaces/new",
      name: "workspace-create",
      component: CreateWorkspacePage,
      meta: {
        breadcrumb: "Create",
      },
    },
    {
      path: "/runtime/:id",
      component: RuntimeWorkspaceLayoutPage,
      meta: {
        breadcrumb: "Runtime",
      },
      children: [
        {
          path: "",
          redirect: (to) => ({
            name: "runtime-overview",
            params: {
              id: to.params.id,
            },
          }),
        },
        {
          path: "overview",
          name: "runtime-overview",
          component: RuntimeOverviewPage,
          meta: {
            breadcrumb: "Dashboard",
          },
          props: (route) => ({
            workspaceId: String(route.params.id),
          }),
        },
        {
          path: "settings",
          name: "runtime-settings",
          component: RuntimeSettingsPage,
          meta: {
            breadcrumb: "Settings",
          },
          props: (route) => ({
            workspaceId: String(route.params.id),
          }),
        },
        {
          path: "agent/:agentId",
          name: "runtime-agent",
          component: RuntimeAgentPage,
          meta: {
            breadcrumb: "Agent",
          },
          props: (route) => ({
            workspaceId: String(route.params.id),
            agentId: String(route.params.agentId),
          }),
        },
      ],
    },
    {
      path: "/solver/:id",
      name: "solver",
      component: SolverWorkspacePage,
      meta: {
        breadcrumb: "Solver",
      },
    },
  ],
})
