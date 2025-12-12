-- Migration: Criar tabela bling_integrations
-- Descrição: Tabela para armazenar configurações de integração com o Bling ERP
-- Data: 2025-11-26

-- Criar tabela se não existir
CREATE TABLE IF NOT EXISTS bling_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL,
  client_id VARCHAR NOT NULL,
  client_secret VARCHAR NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  "isActive" BOOLEAN DEFAULT false,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign Key
  CONSTRAINT fk_bling_integrations_user 
    FOREIGN KEY (user_id) 
    REFERENCES users(id) 
    ON DELETE CASCADE
);

-- Criar índice para melhorar performance de consultas
CREATE INDEX IF NOT EXISTS idx_bling_integrations_user_id 
  ON bling_integrations(user_id);

-- Comentários para documentação
COMMENT ON TABLE bling_integrations IS 'Armazena configurações de integração com o Bling ERP por usuário';
COMMENT ON COLUMN bling_integrations.id IS 'Identificador único da integração';
COMMENT ON COLUMN bling_integrations.user_id IS 'ID do usuário proprietário da integração';
COMMENT ON COLUMN bling_integrations.client_id IS 'Client ID do aplicativo Bling';
COMMENT ON COLUMN bling_integrations.client_secret IS 'Client Secret do aplicativo Bling';
COMMENT ON COLUMN bling_integrations.access_token IS 'Access Token OAuth 2.0 (renovado automaticamente)';
COMMENT ON COLUMN bling_integrations.refresh_token IS 'Refresh Token OAuth 2.0';
COMMENT ON COLUMN bling_integrations.token_expires_at IS 'Data/hora de expiração do access token';
COMMENT ON COLUMN bling_integrations."isActive" IS 'Indica se a integração está ativa e autorizada';
COMMENT ON COLUMN bling_integrations.last_sync_at IS 'Data/hora da última sincronização com o Bling';

-- Verificar se a tabela foi criada
SELECT 
  table_name,
  table_schema
FROM information_schema.tables
WHERE table_name = 'bling_integrations';
