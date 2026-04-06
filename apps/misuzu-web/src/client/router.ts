import { createRouter, createWebHistory } from "vue-router"
import HomeView from "./views/HomeView.vue"
import RuntimeWorkspaceView from "./views/RuntimeWorkspaceView.vue"
import SolverWorkspaceView from "./views/SolverWorkspaceView.vue"

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: HomeView,
    },
    {
      path: "/runtime/:id",
      component: RuntimeWorkspaceView,
    },
    {
      path: "/solver/:id",
      component: SolverWorkspaceView,
    },
  ],
})
