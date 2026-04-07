import { createApp } from "vue"
import { createPinia } from "pinia"
import { PiniaColada } from "@pinia/colada"
import App from "./App.vue"
import { provideAppServices } from "@/shared/di/app-services.ts"
import { router } from "./router.ts"
import "../styles.css"

const app = createApp(App)

const pinia = createPinia()

app.use(pinia)
app.use(PiniaColada)
app.use(router)
provideAppServices(app)

app.mount("#app")
