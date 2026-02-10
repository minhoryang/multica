-- Telegram users table for Gateway
-- Run this manually before starting the Gateway with Telegram enabled.

DROP TABLE IF EXISTS telegram_users;

CREATE TABLE telegram_users (
  telegram_user_id VARCHAR(64) PRIMARY KEY,
  hub_id VARCHAR(64) NOT NULL,
  agent_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  telegram_username VARCHAR(255),
  telegram_first_name VARCHAR(255),
  telegram_last_name VARCHAR(255),
  INDEX idx_device_id (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
