export function developmentSigning(options:{root:string;env:Record<string,string|undefined>;platform:string;command:string}):{APPLE_SIGNING_IDENTITY?:string}
export function developmentSigningConfig(options:{platform:string;command:string;debug:boolean;identity?:string}):{bundle:{macOS:{hardenedRuntime:false}}}|undefined

export function requireDevelopmentIdentity(identity?:string):string
export function needsDevelopmentRunner(options:{args:string[];platform:string}):boolean
export function developmentConfiguration(options:{root:string;env:Record<string,string|undefined>}):{identifier?:string;build:{runner?:string}}
export function developmentRunnerEnvironment(options:{root:string;args:string[];platform:string;nodePath:string;runnerPath:string;env:Record<string,string|undefined>}):Record<string,string>
