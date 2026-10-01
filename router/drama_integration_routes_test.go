package router

import "testing"

func TestNewRegistersDramaIntegrationSurfaces(t *testing.T) {
	want := map[string]bool{
		"GET /api/v1/drama/projects/:project": true,
		"PATCH /api/v1/drama/projects/:project": true,
		"GET /api/v1/drama/projects/:project/characters/:character/identities": true,
		"GET /api/v1/drama/projects/:project/scenes": true,
		"GET /api/v1/drama/projects/:project/scenes/plate-preview": true,
		"POST /api/v1/drama/projects/:project/props/:name/reference/generate-async": true,
		"GET /api/v1/drama/projects/:project/props/:name/reference/task": true,
		"GET /api/v1/drama/projects/:project/tasks": true,
		"GET /api/v1/drama/projects/:project/tasks/limits": true,
		"GET /api/v1/drama/projects/:project/tasks/stream": true,
		"GET /api/v1/drama/projects/:project/tasks/:task_type/:episode": true,
		"DELETE /api/v1/drama/projects/:project/tasks/:task_type/:episode": true,
	}
	for _, route := range New().Routes() {
		delete(want, route.Method+" "+route.Path)
	}
	for route := range want {
		t.Errorf("missing DramaClaw integration route %s", route)
	}
}
