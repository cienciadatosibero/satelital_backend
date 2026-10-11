-- Esquema REAL exportado de TiDB Cloud, adaptado para CREATE TABLE IF NOT EXISTS.
-- No altera tablas ni datos existentes.
-- Orden según dependencias de claves foráneas.

CREATE TABLE IF NOT EXISTS `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `usuario` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rol` enum('admin','invitado') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'invitado',
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `usuario` (`usuario`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `modelos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(140) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `archivo` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `framework` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'yolo',
  `clases` json DEFAULT NULL,
  `conf_default` decimal(4,3) NOT NULL DEFAULT '0.250',
  `activo` tinyint(1) NOT NULL DEFAULT '0',
  `subido_por` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_modelo_usuario` (`subido_por`),
  CONSTRAINT `fk_modelo_usuario` FOREIGN KEY (`subido_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sesiones_busqueda` (
  `id` int NOT NULL AUTO_INCREMENT,
  `usuario_id` int NOT NULL,
  `modelo_id` int DEFAULT NULL,
  `nombre` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Sesión sin título',
  `bounds_north` decimal(10,7) DEFAULT NULL,
  `bounds_south` decimal(10,7) DEFAULT NULL,
  `bounds_east` decimal(10,7) DEFAULT NULL,
  `bounds_west` decimal(10,7) DEFAULT NULL,
  `zoom` int DEFAULT NULL,
  `total_detecciones` int NOT NULL DEFAULT '0',
  `estado` enum('en_progreso','revisada','exportada') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'en_progreso',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_sesion_modelo` (`modelo_id`),
  KEY `idx_sesion_usuario` (`usuario_id`),
  CONSTRAINT `fk_sesion_modelo` FOREIGN KEY (`modelo_id`) REFERENCES `modelos` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sesion_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `celdas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sesion_id` int NOT NULL,
  `fila` int NOT NULL,
  `col` int NOT NULL,
  `north` decimal(10,7) NOT NULL,
  `south` decimal(10,7) NOT NULL,
  `east` decimal(10,7) NOT NULL,
  `west` decimal(10,7) NOT NULL,
  `img_path` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `img_w` int DEFAULT NULL,
  `img_h` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_celda_sesion` (`sesion_id`),
  CONSTRAINT `fk_celda_sesion` FOREIGN KEY (`sesion_id`) REFERENCES `sesiones_busqueda` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `detecciones` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sesion_id` int NOT NULL,
  `celda_id` int DEFAULT NULL,
  `clase` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `confianza` decimal(5,4) NOT NULL,
  `lat` decimal(10,7) NOT NULL,
  `lng` decimal(10,7) NOT NULL,
  `bbox_x` int NOT NULL,
  `bbox_y` int NOT NULL,
  `bbox_w` int NOT NULL,
  `bbox_h` int NOT NULL,
  `recorte_path` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `deteccion_path` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `revision` enum('pendiente','confirmado','descartado') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pendiente',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_det_sesion` (`sesion_id`),
  KEY `idx_det_revision` (`revision`),
  KEY `fk_det_celda` (`celda_id`),
  CONSTRAINT `fk_det_celda` FOREIGN KEY (`celda_id`) REFERENCES `celdas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_det_sesion` FOREIGN KEY (`sesion_id`) REFERENCES `sesiones_busqueda` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
