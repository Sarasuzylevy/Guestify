FROM node:20-alpine

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./
RUN npm install --force

# Copier tout le code de l'application
COPY . .

# Exposer le port du serveur Guestify
EXPOSE 3000

# Démarrer le serveur
CMD ["npm", "run", "dev"]