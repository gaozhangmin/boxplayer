export function developmentSigning(options:{root:string;env:Record<string,string|undefined>;platform:string;command:string}):{APPLE_SIGNING_IDENTITY?:string}
export function developmentSigningConfig(options:{platform:string;command:string;debug:boolean;identity?:string}):{bundle:{macOS:{hardenedRuntime:false}}}|undefined
