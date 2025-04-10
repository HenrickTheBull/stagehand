#!/bin/bash

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "This script must be run as root (use sudo)"
  exit 1
fi

# Define file paths
SERVICE_NAME="stagehand"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
SERVICE_FILE="$SCRIPT_DIR/$SERVICE_NAME.service"
SYSTEMD_DIR="/etc/systemd/system"

# Copy the service file
echo "Copying $SERVICE_NAME.service to $SYSTEMD_DIR..."
cp "$SERVICE_FILE" "$SYSTEMD_DIR/"

# Set proper permissions
echo "Setting permissions..."
chmod 644 "$SYSTEMD_DIR/$SERVICE_NAME.service"

# Reload systemd to recognize new service
echo "Reloading systemd daemon..."
systemctl daemon-reload

# Enable the service
echo "Enabling $SERVICE_NAME service..."
systemctl enable "$SERVICE_NAME"

echo "Service installation complete!"
echo "You can start the service with: sudo systemctl start $SERVICE_NAME"
echo "Check service status with: systemctl status $SERVICE_NAME"

# Ask if the user wants to start the service now
read -p "Do you want to start the service now? (y/n): " START_NOW
if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
  echo "Starting $SERVICE_NAME service..."
  systemctl start "$SERVICE_NAME"
  echo "Service started."
fi