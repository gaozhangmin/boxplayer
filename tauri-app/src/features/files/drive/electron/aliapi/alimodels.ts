export interface IAliFileVideoMeta {
  bitrate?: string
  clarity?: string
  code_name?: string
  duration?: string
  fps?: string
}

export interface IAliFileAudioMeta {
  bit_rate?: string
  channel_layout?: string
  channels?: number
  code_name?: string
  duration?: string
  sample_rate?: string
}

export interface IAliAlbumInfo {
  owner: string
  name: string
  description: string
  coverUrl: string
  album_id: string
  file_count: number
  image_count: number
  video_count: number
  created_at: number
  updated_at: number,
}

export interface IAliFileItem {
  drive_id: string
  domain_id: string
  description?: string
  file_id: string
  album_id?: string
  compilation_id?: string
  name: string
  type: string
  video_type?: string
  content_type: string
  created_at: string
  updated_at: string
  last_played_at?: string
  gmt_cleaned?: string
  gmt_deleted?: string
  file_extension?: string
  hidden: boolean
  file_count?: number
  image_count?: number
  video_count?: number
  size: number
  starred: boolean
  status: string
  upload_id: string
  parent_file_id: string
  crc64_hash: string
  content_hash: string
  content_hash_name: string
  download_url: string
  url: string
  category: string
  encrypt_mode: string
  punish_flag: number
  from_share_id?: string
  thumbnail?: string
  mime_extension: string
  mime_type: string
  play_cursor: string
  duration: string
  video_media_metadata?: {
    duration?: string | number
    height?: number
    width?: number
    time?: string
    video_media_video_stream?: IAliFileVideoMeta[] | IAliFileVideoMeta
    video_media_audio_stream?: IAliFileAudioMeta[] | IAliFileAudioMeta
  }

  video_preview_metadata?: {
    duration?: string | number
    height?: number
    width?: number
    time?: string
    audio_format?: string
    bitrate?: string
    frame_rate?: string
    video_format?: string
    template_list?: [{ template_id: string; status: string }]
    audio_template_list?: [{ template_id: string; status: string }]
  }

  image_media_metadata?: {
    height?: number
    width?: number
    time?: string
    exif?: string
  }

  user_meta?: string
  path?: string
}


export interface IAliOtherFollowingModel {
  avatar: string
  description: string
  is_following: boolean
  nick_name: string
  phone: string
  user_id: string
  follower_count: number
}

interface IAliMyFollowingMessageModel {
  action: string
  content: {
    file_id_list: string[]
    share: { popularity: number; popularity_emoji: string; popularity_str: string; share_id: string; share_pwd: string }
  }
  created: number
  createdstr: string
  creator: IAliOtherFollowingModel
  creator_id: string
  display_action: string
  sequence_id: number
}


export interface IAliMyFollowingModel {
  avatar: string
  description: string
  has_unread_message: boolean
  is_following: boolean
  latest_messages: IAliMyFollowingMessageModel[]
  nick_name: string
  phone: string
  user_id: string
  SearchName: string
}

export interface IAliShareBottleFish {
  bottleId: string;
  bottleName: string;
  shareId: string;
}

export interface IAliShareItem {
  created_at: string
  creator: string
  description: string
  display_name: string
  display_label: string
  download_count: number
  drive_id: string
  expiration: string
  expired: boolean
  file_id: string
  file_id_list: string[]
  icon: string
  first_file?: IAliFileItem
  preview_count: number
  save_count: number
  share_id: string

  share_msg: string
  full_share_msg: string
  share_name: string
  share_policy: string
  share_pwd: string
  share_url: string
  status: string
  updated_at: string

  is_share_saved: boolean
  share_saved: string
}

export interface IAliShareRecentItem {
  popularity: number;
  browse_count: number;
  share_id: string;
  share_msg: string;
  share_name: string;
  share_url: string;
  creator: string;
  file_id_list: string[];
  preview_count: number;
  save_count: number;
  status: string;
  share_subtitle: string;
  gmt_created: string;
  gmt_modified: string;
  is_public: boolean;
  file_list: {
    name: string;
    type: string;
    category: string;
    parent_file_id: string;
    drive_id: string;
    file_id: string;
    created_at: string;
    updated_at: string;
    trashed_at: string | null;
  }[];
  creator_name: string;
  creator_uid: string;
  file_count: number;
  is_punished: boolean;
  share_creator: {
    userId: string;
    avatar: string;
    displayName: string;
  };
  popularity_str: string;
  popularity_emoji: string;
  full_share_msg: string;
  share_title: string;
  display_name: string;
}

export interface IAliShareBottleFishItem {
  bottleId: string;
  gmtCreate: number;
  id: number;
  name: string;
  saved: boolean;
  shareId: string;
  gmt_created: string;
  saved_msg: string;
  share_name: string;
  display_name: string;
}

export interface IAliShareAnonymous {
  shareinfo: {
    share_id: string
    creator_id: string
    creator_name: string
    creator_phone: string
    display_name: string
    expiration: string
    file_count: number
    share_name: string
    created_at: string
    updated_at: string
    vip: string
    is_photo_collection: boolean
    album_id: string
  }
  shareinfojson: string
  error: string
}


export interface IAliShareFileItem {
  drive_id: string
  // domain_id: string
  file_id: string
  name: string
  type: string
  created_at: string
  updated_at: string
  // hidden: boolean
  // starred: boolean
  // status: string
  parent_file_id: string
  // encrypt_mode: string
  // revision_id: string

  file_extension?: string
  mime_extension: string
  mime_type: string
  size: number
  // content_hash: string
  // content_hash_name: string
  category: string
  punish_flag: number


  isDir: boolean
  sizeStr: string
  timeStr: string
  icon: string
}


export interface IAliGetForderSizeModel {
  size: number
  folder_count: number
  file_count: number
  reach_limit?: boolean
}


export interface IAliGetDirModel {
  __v_skip: true
  drive_id: string
  user_id?: string
  file_id: string
  album_id?: string
  album_type?: string
  parent_file_id: string
  name: string
  namesearch: string
  path?: string
  size: number
  time: number
  punish_flag?: number
  description: string
}


export interface IAliGetFileModel {
  __v_skip: true
  drive_id: string
  file_id: string
  parent_file_id: string
  name: string
  namesearch: string
  path?: string
  ext: string
  mime_type: string
  mime_extension: string
  category: string
  icon: string
  file_count?: number
  size: number
  sizeStr: string
  time: number
  timeStr: string
  starred: boolean
  isDir: boolean
  thumbnail: string
  punish_flag?: number
  from_share_id?: string
  description: string
  album_id?: string
  compilation_id?: string
  download_url?: string
  media_width?: number
  media_height?: number
  media_duration?: string
  media_play_cursor?: string
  media_time?: string
  user_meta?: string
  content_hash?: string
  content_hash_name?: string
}
