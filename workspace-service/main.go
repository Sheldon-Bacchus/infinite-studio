package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/tigerowo/infinite-canvas/workspace-service/internal/workspace"
)

const defaultDataRoot = `E:\all-agent-workspace\infinite-studio-data`

func main() {
	dataRoot := flag.String("data-root", defaultDataRoot, "absolute workspace data directory")
	initializeNew := flag.Bool("initialize-new", false, "initialize an empty new workspace at data-root")
	prepareSource := flag.String("prepare-copy-source", "", "prepare an isolated copy of an existing workspace")
	prepareTarget := flag.String("prepare-copy-target", "", "new isolated directory for the prepared workspace copy")
	createBackup := flag.String("create-backup", "", "new backup directory inside the data root backups directory")
	verifyBackup := flag.String("verify-backup", "", "verify a completed backup directory")
	restoreBackup := flag.String("restore-backup", "", "verified backup directory to restore")
	restoreTarget := flag.String("restore-target", "", "new empty directory for restored workspace data")
	flag.Parse()

	modes := 0
	for _, selected := range []bool{*initializeNew, *prepareSource != "" || *prepareTarget != "", *createBackup != "", *verifyBackup != "", *restoreBackup != "" || *restoreTarget != ""} {
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
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server := &http.Server{Addr: "127.0.0.1:8086", Handler: app.Handler()}
	serveResult := make(chan error, 1)
	go func() { serveResult <- server.ListenAndServe() }()
	log.Printf("workspace service listening on %s", server.Addr)
	select {
	case err := <-serveResult:
		if !errors.Is(err, http.ErrServerClosed) {
			_ = app.Close()
			log.Fatal(err)
		}
	case <-ctx.Done():
		if err := server.Shutdown(context.Background()); err != nil {
			log.Printf("workspace service shutdown failed: %v", err)
		}
	}
	if err := app.Close(); err != nil {
		log.Printf("close workspace: %v", err)
	}
}
