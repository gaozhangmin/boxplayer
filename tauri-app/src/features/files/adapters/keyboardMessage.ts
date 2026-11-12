export interface KeyboardMessage {

  Code: string

  Key: string
  Ctrl: boolean
  Shift: boolean
  Alt: boolean

  Repeat: boolean

  IsInput: boolean
  IsEnmpty: boolean
}

