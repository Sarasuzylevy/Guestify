CREATE DATABASE IF NOT EXISTS guestify;
USE guestify;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS vendors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_name VARCHAR(255) NOT NULL,
    service_category VARCHAR(100) NOT NULL,
    contact_email VARCHAR(255),
    phone VARCHAR(50),
    description TEXT
);

INSERT IGNORE INTO master_tasks (name) VALUES
('Photography'), ('Decoration'), ('Venue'), ('Flowers'),
('Wedding Dress'), ('Guest Favors'), ('Catering'), ('Music & DJ');

INSERT IGNORE INTO vendors (business_name, service_category, contact_email, phone, description) VALUES
('Lumière & Co. Studio', 'Photography', 'contact@lumiere-studio.example.com', '050-111-2233', 'Reportage photo et vidéo naturel pour mariages et événements.'),
('Fleurs d''Éden', 'Flowers', 'bonjour@fleurs-eden.example.com', '052-444-5566', 'Compositions florales sur mesure, bouquets de mariée et arches fleuries.'),
('Le Palais des Oliviers', 'Venue', 'events@palais-oliviers.example.com', '054-777-8899', 'Domaine et salle de réception avec jardin extérieur pour mariages.'),
('Saveurs & Délices Traiteur', 'Catering', 'info@saveurs-delices.example.com', '053-222-3344', 'Menu gastronomique complet, buffet cocktail et pièce montée.'),
('Atelier Blanc Couture', 'Wedding Dress', 'salon@atelier-blanc.example.com', '058-999-0011', 'Création et retouches de robes de mariée sur mesure.');