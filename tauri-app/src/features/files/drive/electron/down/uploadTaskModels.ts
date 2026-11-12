export interface IStateUploadTaskFile {
  
  TaskID: number
  
  UploadID: number
  
  partPath: string
  
  name: string
  
  size: number
  sizeStr: string
  
  mtime: number
  
  isDir: boolean
  IsRoot: boolean
  
  uploaded_is_rapid: boolean
  
  uploaded_file_id: string
}

export interface IStateUploadTask {
  
  TaskID: number
  
  TaskName: string
  
  TaskFileID: string
  
  user_id: string
  parent_file_id: string
  parent_description?: string
  drive_id: string
  
  check_name_mode: string

  isDir: boolean
  encType: string

  localFilePath: string

  
  Children: IStateUploadTaskFile[]
  
  ChildTotalCount: number
  
  ChildFinishCount: number
  
  ChildTotalSize: number
  
  ChildFinishSize: number
}
