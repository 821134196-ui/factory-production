CREATE TABLE `groups` (
  `id` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `users` (
  `id` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(255) NOT NULL,
  `role` VARCHAR(255) NOT NULL,
  `group_id` VARCHAR(255),
  `active` BIGINT NOT NULL DEFAULT (1),
  `font_size` BIGINT NOT NULL DEFAULT (22),
  `expected` BIGINT NOT NULL DEFAULT (1),
  `is_leader` BIGINT NOT NULL DEFAULT (0),
  `source_json` LONGTEXT NOT NULL DEFAULT ('[]'),
  `is_super_admin` BIGINT NOT NULL DEFAULT (0),
  `permissions_json` LONGTEXT NOT NULL DEFAULT ('[]'),
  `deleted_at` VARCHAR(255) NOT NULL DEFAULT (''),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE NO ACTION,
  UNIQUE KEY `users_single_super_admin` ((IF(is_super_admin=1,1,NULL))),
  UNIQUE KEY `worker_name_unique` ((IF(role='worker',name,NULL))),
  UNIQUE KEY (`phone`),
  CHECK (role IN ('worker','admin'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `products` (
  `id` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `spec` LONGTEXT NOT NULL DEFAULT (''),
  `category` VARCHAR(255) NOT NULL,
  `unit` VARCHAR(255) NOT NULL,
  `precision` BIGINT NOT NULL DEFAULT (0),
  `weight_kg` DOUBLE,
  `group_id` VARCHAR(255),
  `active` BIGINT NOT NULL DEFAULT (1),
  `source` LONGTEXT NOT NULL DEFAULT (''),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `records` (
  `id` VARCHAR(255) NOT NULL,
  `production_date` VARCHAR(255) NOT NULL,
  `product_id` VARCHAR(255),
  `product_json` LONGTEXT NOT NULL,
  `group_id` VARCHAR(255),
  `mode` VARCHAR(255) NOT NULL,
  `quantity` DOUBLE NOT NULL,
  `original_quantity` DOUBLE NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  `submitted_by` VARCHAR(255) NOT NULL,
  `submitted_at` VARCHAR(255) NOT NULL,
  `updated_at` VARCHAR(255) NOT NULL,
  `version` BIGINT NOT NULL DEFAULT (1),
  `request_id` VARCHAR(255) NOT NULL,
  `payload_hash` VARCHAR(255) NOT NULL,
  `remark` LONGTEXT NOT NULL DEFAULT (''),
  `rejection_reason` LONGTEXT NOT NULL DEFAULT (''),
  `shift` VARCHAR(255) NOT NULL DEFAULT (''),
  `batch_code` VARCHAR(255) NOT NULL DEFAULT (''),
  `source_ref` VARCHAR(255) NOT NULL DEFAULT (''),
  `deleted_at` VARCHAR(255) NOT NULL DEFAULT (''),
  `revision_at` VARCHAR(255) NOT NULL DEFAULT (''),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE NO ACTION,
  FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION,
  UNIQUE KEY `records_source_unique` ((NULLIF(source_ref,''))),
  KEY (`production_date`),
  UNIQUE KEY (`submitted_by`,`request_id`),
  CHECK (status IN ('pending','approved','rejected')),
  rowid BIGINT NOT NULL AUTO_INCREMENT INVISIBLE UNIQUE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `members` (
  `record_id` VARCHAR(255) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`record_id`, `user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  FOREIGN KEY (`record_id`) REFERENCES `records` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `history` (
  `id` VARCHAR(255) NOT NULL,
  `record_id` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(255),
  `action` VARCHAR(255) NOT NULL,
  `before_json` LONGTEXT NOT NULL,
  `after_json` LONGTEXT NOT NULL,
  `reason` LONGTEXT NOT NULL,
  `created_at` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  FOREIGN KEY (`record_id`) REFERENCES `records` (`id`) ON DELETE NO ACTION,
  rowid BIGINT NOT NULL AUTO_INCREMENT INVISIBLE UNIQUE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `attendance` (
  `user_id` VARCHAR(255) NOT NULL,
  `production_date` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`user_id`, `production_date`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  CHECK (status IN ('rest','stopped'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `notices` (
  `id` VARCHAR(255) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `record_id` VARCHAR(255),
  `message` LONGTEXT NOT NULL,
  `created_at` VARCHAR(255) NOT NULL,
  `read_at` VARCHAR(255),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`record_id`) REFERENCES `records` (`id`) ON DELETE NO ACTION,
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  KEY (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `change_requests` (
  `id` VARCHAR(255) NOT NULL,
  `record_id` VARCHAR(255) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `reason` LONGTEXT NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT ('open'),
  `created_at` VARCHAR(255) NOT NULL,
  `resolved_at` VARCHAR(255),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  FOREIGN KEY (`record_id`) REFERENCES `records` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `sessions` (
  `token_hash` VARCHAR(255) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `expires_at` BIGINT NOT NULL,
  PRIMARY KEY (`token_hash`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `codes` (
  `phone` VARCHAR(255) NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `expires_at` BIGINT NOT NULL,
  `sent_at` BIGINT NOT NULL,
  `attempts` BIGINT NOT NULL DEFAULT (0),
  `consumed` BIGINT NOT NULL DEFAULT (0),
  PRIMARY KEY (`phone`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `app_meta` (
  `key` VARCHAR(255) NOT NULL,
  `value` LONGTEXT NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `imports` (
  `id` VARCHAR(255) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `month` VARCHAR(255) NOT NULL,
  `file_hash` VARCHAR(255) NOT NULL,
  `entries_json` LONGTEXT NOT NULL,
  `created_by` VARCHAR(255) NOT NULL,
  `created_at` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  UNIQUE KEY (`file_hash`,`month`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `leader_requests` (
  `user_id` VARCHAR(255) NOT NULL,
  `request_id` VARCHAR(255) NOT NULL,
  `payload_hash` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`user_id`, `request_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `staff_aliases` (
  `old_id` VARCHAR(255) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `original_json` LONGTEXT NOT NULL,
  `merged_at` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`old_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `permission_history` (
  `id` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(255) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `before_json` LONGTEXT NOT NULL,
  `after_json` LONGTEXT NOT NULL,
  `created_at` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `wage_rates` (
  `product_id` VARCHAR(255) NOT NULL,
  `month` VARCHAR(255) NOT NULL,
  `rate` DOUBLE NOT NULL,
  `basis` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`product_id`, `month`),
  FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION,
  CHECK (basis IN ('tonne','quantity'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `wage_adjustments` (
  `worker_id` VARCHAR(255) NOT NULL,
  `production_date` VARCHAR(255) NOT NULL,
  `amount` DOUBLE NOT NULL,
  `reason` LONGTEXT NOT NULL,
  PRIMARY KEY (`worker_id`, `production_date`),
  FOREIGN KEY (`worker_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `wage_history` (
  `id` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(255) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `target` LONGTEXT NOT NULL,
  `before_json` LONGTEXT NOT NULL,
  `after_json` LONGTEXT NOT NULL,
  `created_at` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `frequent_workers` (
  `leader_id` VARCHAR(255) NOT NULL,
  `worker_id` VARCHAR(255) NOT NULL,
  `uses` BIGINT NOT NULL,
  `last_used` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`leader_id`, `worker_id`),
  FOREIGN KEY (`worker_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  FOREIGN KEY (`leader_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `inventory_openings` (
  `product_id` VARCHAR(255) NOT NULL,
  `start_date` VARCHAR(255) NOT NULL,
  `quantity` DOUBLE NOT NULL,
  `version` BIGINT NOT NULL DEFAULT (1),
  PRIMARY KEY (`product_id`),
  FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `inventory_counts` (
  `product_id` VARCHAR(255) NOT NULL,
  `count_date` VARCHAR(255) NOT NULL,
  `quantity` DOUBLE NOT NULL,
  `version` BIGINT NOT NULL DEFAULT (1),
  PRIMARY KEY (`product_id`, `count_date`),
  FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `shipments` (
  `id` VARCHAR(255) NOT NULL,
  `shipping_date` VARCHAR(255) NOT NULL,
  `customer` VARCHAR(255) NOT NULL,
  `weighed_tonnes` DOUBLE,
  `entries_json` LONGTEXT NOT NULL,
  `created_by` VARCHAR(255),
  `created_at` VARCHAR(255) NOT NULL,
  `updated_at` VARCHAR(255) NOT NULL,
  `version` BIGINT NOT NULL DEFAULT (1),
  `deleted_at` VARCHAR(255) NOT NULL DEFAULT (''),
  `request_id` VARCHAR(255) NOT NULL,
  `payload_hash` VARCHAR(255) NOT NULL,
  `vehicle_number` VARCHAR(255) NOT NULL DEFAULT (''),
  `pump_file_id` VARCHAR(255) NOT NULL DEFAULT (''),
  PRIMARY KEY (`id`),
  FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  KEY (`shipping_date`),
  UNIQUE KEY (`created_by`,`request_id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `inventory_history` (
  `id` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(255),
  `kind` VARCHAR(255) NOT NULL,
  `entity_id` VARCHAR(255) NOT NULL,
  `before_json` LONGTEXT NOT NULL,
  `after_json` LONGTEXT NOT NULL,
  `reason` LONGTEXT NOT NULL,
  `created_at` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  rowid BIGINT NOT NULL AUTO_INCREMENT INVISIBLE UNIQUE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `admin_account_history` (
  `id` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(255) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `action` VARCHAR(255) NOT NULL,
  `before_json` LONGTEXT NOT NULL,
  `after_json` LONGTEXT NOT NULL,
  `created_at` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `shipment_files` (
  `id` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `mime` VARCHAR(255) NOT NULL,
  `data` LONGBLOB NOT NULL,
  `created_by` VARCHAR(255) NOT NULL,
  `created_at` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `monthly_stocktakes` (
  `month` VARCHAR(255) NOT NULL,
  `product_id` VARCHAR(255) NOT NULL,
  `status` VARCHAR(255) NOT NULL,
  `fingerprint` VARCHAR(255) NOT NULL,
  `actor_id` VARCHAR(255) NOT NULL,
  `updated_at` VARCHAR(255) NOT NULL,
  `version` BIGINT NOT NULL DEFAULT (1),
  PRIMARY KEY (`month`, `product_id`),
  FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE NO ACTION,
  FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION,
  CHECK (status IN ('confirmed','error'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `wage_policy_dates` (
  `effective_date` VARCHAR(255) NOT NULL,
  `policy_json` LONGTEXT NOT NULL,
  PRIMARY KEY (`effective_date`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `inventory_month_openings` (
  `product_id` VARCHAR(255) NOT NULL,
  `month` VARCHAR(255) NOT NULL,
  `quantity` DOUBLE,
  `source_ref` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`product_id`, `month`),
  FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `history_source_rows` (
  `source_ref` VARCHAR(255) NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `target_id` VARCHAR(255) NOT NULL,
  `source_json` LONGTEXT NOT NULL,
  `created_at` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`source_ref`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `monthly_stocktake_reopens` (
  `month` VARCHAR(255) NOT NULL,
  `product_id` VARCHAR(255) NOT NULL,
  `review_version` BIGINT NOT NULL,
  PRIMARY KEY (`month`, `product_id`),
  FOREIGN KEY (`month`, `product_id`) REFERENCES `monthly_stocktakes` (`month`, `product_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
