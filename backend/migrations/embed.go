// Package migrations embeds the SQL migration files so the server binary can
// apply them at startup without relying on files being present on disk.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
