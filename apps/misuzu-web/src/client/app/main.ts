import { createApp } from "vue"
import { createPinia } from "pinia"
import App from "./App.vue"
import { provideAppServices } from "@/shared/di/app-services.ts"
import { router } from "./router.ts"
import "../styles.css"

const app = createApp(App)

app.use(createPinia())
app.use(router)
provideAppServices(app)

app.mount("#app")
