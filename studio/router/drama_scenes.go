package router

import (
	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/handler"
)

// RegisterDramaSceneRoutes mounts the explicit scene proxy routes into an
// existing authenticated v1 group. The parent router owns group middleware.
func RegisterDramaSceneRoutes(v1 *gin.RouterGroup) {
	v1.GET("/drama/projects/:project/scenes", func(c *gin.Context) {
		handler.DramaScenesList(c.Writer, c.Request, c.Param("project"))
	})
	v1.GET("/drama/projects/:project/scenes/plate-preview", func(c *gin.Context) {
		handler.DramaScenePlatePreview(c.Writer, c.Request, c.Param("project"))
	})
	v1.POST("/drama/projects/:project/scenes/build", func(c *gin.Context) {
		handler.DramaSceneBuild(c.Writer, c.Request, c.Param("project"))
	})
	v1.GET("/drama/projects/:project/scenes/build-task", func(c *gin.Context) {
		handler.DramaSceneBuildTask(c.Writer, c.Request, c.Param("project"))
	})
	v1.POST("/drama/projects/:project/scenes/:name/generate/:operation", func(c *gin.Context) {
		handler.DramaSceneGenerate(c.Writer, c.Request, c.Param("project"), c.Param("name"), c.Param("operation"))
	})
	v1.GET("/drama/projects/:project/scenes/:name/tasks/:operation", func(c *gin.Context) {
		handler.DramaSceneTask(c.Writer, c.Request, c.Param("project"), c.Param("name"), c.Param("operation"))
	})
	v1.POST("/drama/projects/:project/scenes/:name/:kind/upload", func(c *gin.Context) {
		handler.DramaSceneUpload(c.Writer, c.Request, c.Param("project"), c.Param("name"), c.Param("kind"))
	})
	v1.POST("/drama/projects/:project/scenes/:name/:kind/delete", func(c *gin.Context) {
		handler.DramaSceneFileDelete(c.Writer, c.Request, c.Param("project"), c.Param("name"), c.Param("kind"))
	})
}
