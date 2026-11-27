import type { QuartzComponentConstructor } from "@quartz-community/types"

export interface WalineCommentsOptions {
  /** URL do servidor Waline (ex.: https://meu-waline.vercel.app) */
  serverURL: string
  /** Idioma da interface (padrão: pt-BR) */
  lang?: string
  /** Campos obrigatórios, separados por vírgula (padrão: nick) */
  requiredMeta?: string
  /** Versão do @waline/client carregada do CDN (padrão: 3.5.0) */
  version?: string
}

export declare const WalineComments: QuartzComponentConstructor<WalineCommentsOptions>
