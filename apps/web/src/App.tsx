import { Route, Routes } from "react-router-dom"
import WorkspaceDetail from "@/pages/WorkspaceDetail"
import WorkspaceList from "@/pages/WorkspaceList"

function App() {
  return (
    <Routes>
      <Route path="/" element={<WorkspaceList />} />
      <Route path="/workspace/:id" element={<WorkspaceDetail />} />
    </Routes>
  )
}

export default App
