# Usa uma imagem oficial do Node.js na versão 20 (LTS)
FROM node:20-slim

# Define o diretório de trabalho dentro do contêiner
WORKDIR /usr/src/app

# Copia os arquivos de definição de pacotes
COPY package*.json ./

# Instala as dependências do projeto
RUN npm install

# Copia todo o resto do código do seu projeto
COPY . .

# Expõe a porta que a API vai usar
EXPOSE 3000

# Comando padrão para iniciar o bot
CMD [ "npm", "start" ]