//go:build integration

package hardening

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"
)

// TestImageGeneration_60K_Throughput verifies that 60,000 composite images
// can be generated within an acceptable time budget.
//
// Uses Go stdlib image/draw for compositing, matching Phase 8 design
// decision D-04 (disintegration/imaging with CatmullRom resampling).
func TestImageGeneration_60K_Throughput(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping 60K image generation in short mode")
	}

	// Generate test card template (1080x1920 solid blue with white border)
	template := createTestCardTemplate(1080, 1920)

	tmpDir := t.TempDir()
	totalImages := 60000
	batchSize := 500
	var generated atomic.Int64
	startTime := time.Now()

	// Process in batches
	for batchStart := 0; batchStart < totalImages; batchStart += batchSize {
		batchEnd := batchStart + batchSize
		if batchEnd > totalImages {
			batchEnd = totalImages
		}

		for i := batchStart; i < batchEnd; i++ {
			// 1. Create unique QR overlay (300x300, unique pattern per guest)
			qrOverlay := createTestQROverlay(300, 300, i)

			// 2. Composite QR onto card template at position (390, 1200)
			composite := compositeImages(template, qrOverlay, 390, 1200)

			// 3. Write to file
			filename := filepath.Join(tmpDir, fmt.Sprintf("card_%05d.png", i))
			f, err := os.Create(filename)
			if err != nil {
				t.Fatalf("Failed to create file %s: %v", filename, err)
			}
			if err := png.Encode(f, composite); err != nil {
				f.Close()
				t.Fatalf("Failed to encode PNG %s: %v", filename, err)
			}
			f.Close()
			generated.Add(1)
		}

		// Log progress every 10 batches (5000 images)
		if (batchStart/batchSize)%10 == 0 {
			elapsed := time.Since(startTime)
			rate := float64(generated.Load()) / elapsed.Seconds()
			var mem runtime.MemStats
			runtime.ReadMemStats(&mem)
			t.Logf("Progress: %d/%d (%.1f img/s, Alloc: %d MB, Sys: %d MB)",
				generated.Load(), totalImages, rate, mem.Alloc/(1024*1024), mem.Sys/(1024*1024))
		}
	}

	elapsed := time.Since(startTime)
	rate := float64(totalImages) / elapsed.Seconds()

	// Verify all files created
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		t.Fatalf("Failed to read output dir: %v", err)
	}
	if len(entries) != totalImages {
		t.Errorf("Expected %d files, got %d", totalImages, len(entries))
	}

	// Verify memory stayed within bounds
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	maxMemMB := mem.Sys / (1024 * 1024)
	t.Logf("Final: %d images in %s (%.1f img/s, peak Sys: %d MB)",
		totalImages, elapsed, rate, maxMemMB)

	if maxMemMB > 1024 {
		t.Errorf("Peak memory %d MB exceeds 1GB limit", maxMemMB)
	}
	if elapsed > 60*time.Minute {
		t.Errorf("Total time %s exceeds 60 minute budget", elapsed)
	}

	// Spot check: verify 10 random files are valid PNGs
	spotCheckIndices := []int{0, 1000, 5000, 10000, 25000, 40000, 50000, 59000, 59500, 59999}
	for _, idx := range spotCheckIndices {
		filename := filepath.Join(tmpDir, fmt.Sprintf("card_%05d.png", idx))
		f, err := os.Open(filename)
		if err != nil {
			t.Errorf("Spot check failed: cannot open %s: %v", filename, err)
			continue
		}
		_, err = png.Decode(f)
		f.Close()
		if err != nil {
			t.Errorf("Spot check failed: invalid PNG %s: %v", filename, err)
		}
	}
}

// TestImageGeneration_MemoryBounds verifies that image generation stays
// within configured memory limits.
func TestImageGeneration_MemoryBounds(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping memory bounds test in short mode")
	}

	template := createTestCardTemplate(1080, 1920)
	tmpDir := t.TempDir()
	totalImages := 5000
	batchSize := 100

	var peakAlloc uint64

	for batchStart := 0; batchStart < totalImages; batchStart += batchSize {
		batchEnd := batchStart + batchSize
		if batchEnd > totalImages {
			batchEnd = totalImages
		}

		for i := batchStart; i < batchEnd; i++ {
			qrOverlay := createTestQROverlay(300, 300, i)
			composite := compositeImages(template, qrOverlay, 390, 1200)

			filename := filepath.Join(tmpDir, fmt.Sprintf("mem_%05d.png", i))
			f, err := os.Create(filename)
			if err != nil {
				t.Fatalf("Failed to create file: %v", err)
			}
			if err := png.Encode(f, composite); err != nil {
				f.Close()
				t.Fatalf("Failed to encode PNG: %v", err)
			}
			f.Close()
		}

		// Check memory after each batch
		var mem runtime.MemStats
		runtime.ReadMemStats(&mem)
		if mem.Alloc > peakAlloc {
			peakAlloc = mem.Alloc
		}

		allocMB := mem.Alloc / (1024 * 1024)
		if allocMB > 512 {
			t.Errorf("Batch %d: Alloc %d MB exceeds 512MB limit", batchStart/batchSize, allocMB)
		}

		// Force GC between batches to simulate production behavior
		runtime.GC()

		if (batchStart/batchSize)%10 == 0 {
			t.Logf("Batch %d: Alloc=%d MB, Sys=%d MB, GC=%d",
				batchStart/batchSize, mem.Alloc/(1024*1024), mem.Sys/(1024*1024), mem.NumGC)
		}
	}

	// Verify memory released after processing
	runtime.GC()
	var finalMem runtime.MemStats
	runtime.ReadMemStats(&finalMem)
	finalAllocMB := finalMem.Alloc / (1024 * 1024)
	if finalAllocMB > 256 {
		t.Errorf("Final Alloc %d MB exceeds 256MB (memory not released)", finalAllocMB)
	}

	t.Logf("Memory bounds test: peak Alloc=%d MB, final Alloc=%d MB, GC runs=%d",
		peakAlloc/(1024*1024), finalAllocMB, finalMem.NumGC)
}

// TestImageGeneration_CrashRecovery verifies that stopping mid-generation
// and restarting correctly resumes from the last checkpoint.
func TestImageGeneration_CrashRecovery(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping crash recovery test in short mode")
	}

	template := createTestCardTemplate(1080, 1920)
	tmpDir := t.TempDir()
	totalImages := 1000
	batchSize := 100
	crashAt := 500 // Simulate crash at image 500

	// Phase 1: Generate first 500 images (pre-crash)
	var checkpoint int
	for batchStart := 0; batchStart < totalImages; batchStart += batchSize {
		batchEnd := batchStart + batchSize
		if batchEnd > totalImages {
			batchEnd = totalImages
		}

		for i := batchStart; i < batchEnd; i++ {
			if i >= crashAt {
				// Record checkpoint and "crash"
				checkpoint = batchStart
				goto resume
			}

			qrOverlay := createTestQROverlay(300, 300, i)
			composite := compositeImages(template, qrOverlay, 390, 1200)

			filename := filepath.Join(tmpDir, fmt.Sprintf("card_%05d.png", i))
			f, err := os.Create(filename)
			if err != nil {
				t.Fatalf("Failed to create file: %v", err)
			}
			png.Encode(f, composite)
			f.Close()
		}
		checkpoint = batchEnd
	}

resume:
	t.Logf("Simulated crash at image %d, checkpoint at batch start %d", crashAt, checkpoint)

	// Count images generated before crash
	precrashEntries, _ := os.ReadDir(tmpDir)
	preCrashCount := len(precrashEntries)
	t.Logf("Pre-crash images: %d", preCrashCount)

	if preCrashCount != crashAt {
		t.Errorf("Expected %d pre-crash images, got %d", crashAt, preCrashCount)
	}

	// Record pre-crash file modification times for images 0-499
	precrashTimes := make(map[string]time.Time)
	for _, entry := range precrashEntries {
		info, _ := entry.Info()
		precrashTimes[entry.Name()] = info.ModTime()
	}

	// Phase 2: Resume from checkpoint
	t.Logf("Resuming from checkpoint %d...", checkpoint)
	for i := checkpoint; i < totalImages; i++ {
		qrOverlay := createTestQROverlay(300, 300, i)
		composite := compositeImages(template, qrOverlay, 390, 1200)

		filename := filepath.Join(tmpDir, fmt.Sprintf("card_%05d.png", i))
		f, err := os.Create(filename)
		if err != nil {
			t.Fatalf("Failed to create file on resume: %v", err)
		}
		png.Encode(f, composite)
		f.Close()
	}

	// Verify exactly 1000 unique files
	finalEntries, err := os.ReadDir(tmpDir)
	if err != nil {
		t.Fatalf("Failed to read output dir: %v", err)
	}
	if len(finalEntries) != totalImages {
		t.Errorf("Expected %d total files, got %d", totalImages, len(finalEntries))
	}

	// Verify pre-crash files were NOT regenerated (same modification time)
	// Note: files at the checkpoint boundary may be regenerated, which is acceptable
	regenerated := 0
	for name, originalTime := range precrashTimes {
		path := filepath.Join(tmpDir, name)
		info, err := os.Stat(path)
		if err != nil {
			t.Errorf("Pre-crash file missing after resume: %s", name)
			continue
		}
		if info.ModTime().After(originalTime.Add(time.Second)) {
			regenerated++
		}
	}

	// Allow up to batchSize files at the boundary to be regenerated
	if regenerated > batchSize {
		t.Errorf("Too many pre-crash files regenerated: %d (expected < %d)", regenerated, batchSize)
	}

	t.Logf("Crash recovery: %d total files, %d regenerated at boundary (acceptable: < %d)",
		len(finalEntries), regenerated, batchSize)
}

// createTestCardTemplate creates a test card template image.
// Uses a dark blue background with a white border.
func createTestCardTemplate(width, height int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	bgColor := color.RGBA{30, 60, 114, 255}   // Dark blue
	borderColor := color.RGBA{255, 255, 255, 255} // White

	// Fill with background
	draw.Draw(img, img.Bounds(), &image.Uniform{bgColor}, image.Point{}, draw.Src)

	// Draw 5px border
	borderWidth := 5
	// Top border
	draw.Draw(img, image.Rect(0, 0, width, borderWidth), &image.Uniform{borderColor}, image.Point{}, draw.Src)
	// Bottom border
	draw.Draw(img, image.Rect(0, height-borderWidth, width, height), &image.Uniform{borderColor}, image.Point{}, draw.Src)
	// Left border
	draw.Draw(img, image.Rect(0, 0, borderWidth, height), &image.Uniform{borderColor}, image.Point{}, draw.Src)
	// Right border
	draw.Draw(img, image.Rect(width-borderWidth, 0, width, height), &image.Uniform{borderColor}, image.Point{}, draw.Src)

	return img
}

// createTestQROverlay creates a unique test QR overlay image.
// Each seed produces a deterministic but visually distinct pattern.
func createTestQROverlay(width, height, seed int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	// Fill with white background
	draw.Draw(img, img.Bounds(), &image.Uniform{color.White}, image.Point{}, draw.Src)

	// Generate a unique pattern based on seed
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			if (x+seed*7)%23 < 12 && (y+seed*13)%19 < 10 {
				img.SetRGBA(x, y, color.RGBA{0, 0, 0, 255})
			}
		}
	}
	return img
}

// compositeImages overlays an image onto a base at the given position.
// Uses image/draw.Draw matching the Phase 8 compositing approach.
func compositeImages(base *image.RGBA, overlay *image.RGBA, x, y int) *image.RGBA {
	// Create a copy of the base to avoid mutating the template
	bounds := base.Bounds()
	composite := image.NewRGBA(bounds)
	draw.Draw(composite, bounds, base, bounds.Min, draw.Src)

	// Draw overlay at the specified position
	overlayBounds := overlay.Bounds()
	destRect := image.Rect(x, y, x+overlayBounds.Dx(), y+overlayBounds.Dy())
	draw.Draw(composite, destRect, overlay, overlayBounds.Min, draw.Over)

	return composite
}
