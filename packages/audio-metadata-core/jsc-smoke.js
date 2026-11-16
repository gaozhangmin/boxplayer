ObjC.import('Foundation')
ObjC.import('JavaScriptCore')
function run(argv) {
  var source = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null)
  var context = $.JSContext.alloc.init
  context.evaluateScript(source)
  if (!context.exception.isNil()) throw new Error(ObjC.unwrap(context.exception.toObject))
  context.evaluateScript("var result=''; BoxPlayerMusicHead.parseNative('SUQzAwAAAAAAFVRJVDIAAAALAAADTG9jYWwgU29uZw==',function(json){result=json;});")
  var result = ObjC.unwrap(context.evaluateScript('result').toObject)
  if (!result || JSON.parse(result).tags.title !== 'Local Song') throw new Error('JavaScriptCore local parser failed')
  return result
}
