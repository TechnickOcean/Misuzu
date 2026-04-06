import { createRouter, createWebHistory } from "vue-router"
import HomeView from "./views/HomeView.vue"
import RuntimeAgentView from "./views/runtime/RuntimeAgentView.vue"
import RuntimeOverviewView from "./views/runtime/RuntimeOverviewView.vue"
import RuntimeWorkspaceLayout from "./views/runtime/RuntimeWorkspaceLayout.vue"
import SolverWorkspaceView from "./views/SolverWorkspaceView.vue"

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomeView,
    },
    {
      path: "/runtime/:id",
      component: RuntimeWorkspaceLayout,
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
          component: RuntimeOverviewView,
          props: (route) => ({
            workspaceId: String(route.params.id),
          }),
        },
        {
          path: "agent/:agentId",
          name: "runtime-agent",
          component: RuntimeAgentView,
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
      component: SolverWorkspaceView,
    },
  ],
})
