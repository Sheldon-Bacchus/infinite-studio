package router

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/handler"
)

// RegisterDramaTaskRoutes attaches exact source-backed task routes to the
// authenticated /api/v1 group supplied by the caller.
func RegisterDramaTaskRoutes(v1 *gin.RouterGroup) {
	root := "/drama/projects/:project/tasks"
	v1.GET(root, func(c *gin.Context) {
		handler.DramaProjectTasks(c.Writer, c.Request, c.Param("project"))
	})
	v1.GET(root+"/limits", func(c *gin.Context) {
		handler.DramaProjectTaskLimits(c.Writer, c.Request, c.Param("project"))
	})
	v1.GET(root+"/stream", func(c *gin.Context) {
		handler.DramaProjectTasksStream(c.Writer, c.Request, c.Param("project"))
	})
	v1.GET(root+"/:task_type/:episode", func(c *gin.Context) {
		episode, err := strconv.Atoi(c.Param("episode"))
		if err != nil {
			handler.FailWithStatus(c.Writer, http.StatusBadRequest, "虾集 episode 必须是整数")
			return
		}
		handler.DramaProjectTaskGet(c.Writer, c.Request, c.Param("project"), c.Param("task_type"), episode)
	})
	v1.DELETE(root+"/:task_type/:episode", func(c *gin.Context) {
		episode, err := strconv.Atoi(c.Param("episode"))
		if err != nil {
			handler.FailWithStatus(c.Writer, http.StatusBadRequest, "虾集 episode 必须是整数")
			return
		}
		handler.DramaProjectTaskCancel(c.Writer, c.Request, c.Param("project"), c.Param("task_type"), episode)
	})
}
