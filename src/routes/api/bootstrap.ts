import { createFileRoute } from "@tanstack/react-router"
import { getDatasets, getUsers, listAreas, listWells } from "@/server"

// Datasets, users, areas and wells (with derived latest status) for the shell and the field map.
export const Route = createFileRoute("/api/bootstrap")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const datasets = await getDatasets()
        const id = new URL(request.url).searchParams.get("dataset") ?? datasets[0]?.id
        if (!id) return Response.json({ datasets, users: [], areas: [], wells: [] })
        const [users, areas, wells] = await Promise.all([getUsers(id), listAreas(id), listWells(id)])
        return Response.json({ datasetId: id, datasets, users, areas, wells })
      },
    },
  },
})
