package r2

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Client wraps an S3-compatible client configured for Cloudflare R2.
type Client struct {
	s3Client   *s3.Client
	bucketName string
	publicURL  string // CDN base URL without trailing slash
}

// NewClient creates a new R2 storage client using the S3-compatible API.
// The accountID is your Cloudflare account ID used to construct the R2 endpoint.
func NewClient(accountID, accessKeyID, secretAccessKey, bucketName, publicURL string) (*Client, error) {
	cfg, err := awsconfig.LoadDefaultConfig(context.TODO(),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
		),
		awsconfig.WithRegion("auto"),
	)
	if err != nil {
		return nil, fmt.Errorf("r2: failed to load AWS config: %w", err)
	}

	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(
			fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID),
		)
	})

	return &Client{
		s3Client:   s3Client,
		bucketName: bucketName,
		publicURL:  strings.TrimRight(publicURL, "/"),
	}, nil
}

// Upload stores a file in R2 at the given key with the specified content type.
func (c *Client) Upload(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := c.s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucketName),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("r2: upload failed for key %q: %w", key, err)
	}
	return nil
}

// PublicURL returns the full public CDN URL for the given object key.
func (c *Client) PublicURL(key string) string {
	return fmt.Sprintf("%s/%s", c.publicURL, key)
}

// BuildKey constructs the R2 object key for a guest's QR code image.
// Format: {eventID}/{guestID}/{typeName}.png
func BuildKey(eventID, guestID string, qrType byte) string {
	return fmt.Sprintf("%s/%s/%s.png", eventID, guestID, qrTypeName(qrType))
}

// Download retrieves an object from R2 by key and returns its bytes.
func (c *Client) Download(ctx context.Context, key string) ([]byte, error) {
	output, err := c.s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucketName),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("r2: download failed for key %q: %w", key, err)
	}
	defer output.Body.Close()

	data, err := io.ReadAll(output.Body)
	if err != nil {
		return nil, fmt.Errorf("r2: failed to read body for key %q: %w", key, err)
	}
	return data, nil
}

// BuildCardKey constructs the R2 object key for a guest's composite card image.
// Format: {eventID}/{guestID}/card.png
func BuildCardKey(eventID, guestID string) string {
	return fmt.Sprintf("%s/%s/card.png", eventID, guestID)
}

// BuildEventPrefix returns the R2 key prefix for all QR codes of an event.
// Useful for listing or bulk-deleting all QR codes for an event.
func BuildEventPrefix(eventID string) string {
	return eventID + "/"
}

// qrTypeName maps QR type bytes to their string representation for R2 keys.
func qrTypeName(qrType byte) string {
	switch qrType {
	case 0x01:
		return "entry"
	case 0x02:
		return "food"
	case 0x03:
		return "unified"
	default:
		return "unknown"
	}
}
