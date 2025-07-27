# Usa uma imagem oficial e leve do Node.js
FROM node:18-slim

# Define o diretório de trabalho dentro do contêiner
WORKDIR /usr/src/app

# Copia os arquivos de definição de pacotes
COPY package*.json ./

# Instala as dependências do projeto
RUN npm install

# Copia todo o resto do código do seu projeto
COPY . .

# Expõe a porta que a API vai usar (o Railway gerencia isso automaticamente)
EXPOSE 3000

# Comando padrão para iniciar o bot
CMD [ "npm", "start" ]