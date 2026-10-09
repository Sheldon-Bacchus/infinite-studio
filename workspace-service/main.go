package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/tigerowo/infinite-canvas/workspace-service/internal/works"
	"github.com/tigerowo/infinite-canvas/workspace-service/internal/workspace"
)

const defaultDataRoot = `E:\all-agent-workspace\infinite-studio-data`

func main() {
	dataRoot := flag.String("data-root", defaultDataRoot, "absolute workspace data directory")
	worksRoot := flag.String("works-root", "", "absolute works repository root (defaults to env LOCAL_WORKS_DATA_ROOT)")
	initializeNew := flag.Bool("initialize-new", false, "initialize an empty new workspace at data-root")
	initializeWorks := flag.Bool("initialize-works", false, "initialize an empty new works repository at works-root")
	rebuildWorksIndex := flag.Bool("rebuild-works-index", false, "rebuild SQLite index from authoritative works repository at works-root")
	prepareSource := flag.String("prepare-copy-source", "", "prepare an isolated copy of an existing workspace")
	prepareTarget := flag.String("prepare-copy-target", "", "new isolated directory for the prepared workspace copy")
	createBackup := flag.String("create-backup", "", "new backup directory inside the data root backups directory")
	verifyBackup := flag.String("verify-backup", "", "verify a completed backup directory")
	restoreBackup := flag.String("restore-backup", "", "verified backup directory to restore")
	restoreTarget := flag.String("restore-target", "", "new empty directory for restored workspace data")
	flag.Parse()

	modes := 0
	for _, selected := range []bool{
		*initializeNew,
		*initializeWorks,
		*rebuildWorksIndex,
		*prepareSource != "" || *prepareTarget != "",
		*createBackup != "",
		*verifyBackup != "",
		*restoreBackup != "" || *restoreTarget != "",
	} {
		if selected {
			modes++
		}
	}
	if modes > 1 {
		log.Fatal("choose only one workspace maintenance mode")
	}
	if *initializeNew {
		if err := workspace.InitializeEmpty(*dataRoot); err != nil {
			log.Fatal(err)
		}
		log.Printf("new isolated workspace initialized at %s", *dataRoot)
		return
	}
	if *initializeWorks {
		root := *worksRoot
		if root == "" {
			root = os.Getenv("LOCAL_WORKS_DATA_ROOT")
		}
		if root == "" {
			log.Fatal("-works-root or LOCAL_WORKS_DATA_ROOT is required to initialize works repository")
		}
		store, err := works.InitializeStore(root)
		if err != nil {
			log.Fatal(err)
		}
		if err := store.Close(); err != nil {
			log.Fatal(err)
		}
		log.Printf("new works repository initialized at %s", root)
		return
	}
	if *rebuildWorksIndex {
		root := *worksRoot
		if root == "" {
			root = os.Getenv("LOCAL_WORKS_DATA_ROOT")
		}
		if root == "" {
			log.Fatal("-works-root or LOCAL_WORKS_DATA_ROOT is required to rebuild works index")
		}
		store, err := works.OpenStore(root)
		if err != nil {
			log.Fatal(err)
		}
		if err := store.RebuildIndex(); err != nil {
			_ = store.Close()
			log.Fatal(err)
		}
		if err := store.Close(); err != nil {
			log.Fatal(err)
		}
		log.Printf("works index rebuilt successfully at %s", root)
		return
	}
	if *prepareSource != "" || *prepareTarget != "" {
		if *prepareSource == "" || *prepareTarget == "" {
			log.Fatal("both -prepare-copy-source and -prepare-copy-target are required")
		}
		if err := workspace.PrepareCopy(*prepareSource, *prepareTarget); err != nil {
			log.Fatal(err)
		}
		log.Printf("isolated workspace copy prepared at %s", *prepareTarget)
		return
	}
	if *verifyBackup != "" {
		verification, err := workspace.VerifyBackup(*verifyBackup)
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("backup verified: workspaceId=%s files=%d", verification.WorkspaceID, verification.Files)
		return
	}
	if *restoreBackup != "" || *restoreTarget != "" {
		if *restoreBackup == "" || *restoreTarget == "" {
			log.Fatal("both -restore-backup and -restore-target are required")
		}
		if err := workspace.RestoreBackup(*restoreBackup, *restoreTarget); err != nil {
			log.Fatal(err)
		}
		log.Printf("workspace restored to isolated directory %s", *restoreTarget)
		return
	}
	if *createBackup != "" {
		app, err := workspace.OpenForMaintenance(*dataRoot)
		if err != nil {
			log.Fatal(err)
		}
		manifest, backupErr := app.CreateBackup(*createBackup)
		closeErr := app.Close()
		if backupErr != nil {
			log.Fatal(backupErr)
		}
		if closeErr != nil {
			log.Fatal(closeErr)
		}
		log.Printf("workspace backup created: workspaceId=%s files=%d", manifest.WorkspaceID, len(manifest.Files))
		return
	}
	app, err := workspace.Open(*dataRoot)
	if err != nil {
		log.Fatal(err)
	}

	targetWorksRoot := *worksRoot
	if targetWorksRoot == "" {
		targetWorksRoot = os.Getenv("LOCAL_WORKS_DATA_ROOT")
	}

	var worksStore *works.Store
	if targetWorksRoot != "" {
		var worksErr error
		worksStore, worksErr = works.OpenStore(targetWorksRoot)
		if worksErr != nil {
			_ = app.Close()
			log.Fatalf("打开本地作品仓库失败 (%s): %v", targetWorksRoot, worksErr)
		}
		log.Printf("works repository opened at %s", targetWorksRoot)
	}

	token := os.Getenv("LOCAL_WORKSPACE_ACCESS_TOKEN")
	worksHandler := works.NewHTTPHandler(worksStore, token)

	combinedHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/local/works" || strings.HasPrefix(r.URL.Path, "/api/local/works/") {
			worksHandler.ServeHTTP(w, r)
			return
		}
		app.Handler().ServeHTTP(w, r)
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server := &http.Server{Addr: "127.0.0.1:8086", Handler: combinedHandler}
	serveResult := make(chan error, 1)
	go func() { serveResult <- server.ListenAndServe() }()
	log.Printf("workspace service listening on %s", server.Addr)
	select {
	case err := <-serveResult:
		if !errors.Is(err, http.ErrServerClosed) {
			if worksStore != nil {
				_ = worksStore.Close()
			}
			_ = app.Close()
			log.Fatal(err)
		}
	case <-ctx.Done():
		if err := server.Shutdown(context.Background()); err != nil {
			log.Printf("workspace service shutdown failed: %v", err)
		}
	}
	if worksStore != nil {
		if err := worksStore.Close(); err != nil {
			log.Printf("close works store: %v", err)
		}
	}
	if err := app.Close(); err != nil {
		log.Printf("close workspace: %v", err)
	}
}
