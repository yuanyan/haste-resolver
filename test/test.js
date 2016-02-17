var HasteResolver = require('../')

var resolver = new HasteResolver({
  roots: ['.']
})

resolver.getHasteMap().then(function(hasteMap){
  var module = hasteMap.getModule('XHR');
  console.log(module.path)
})

resolver.getHasteMap().then(function(hasteMap){
  var module = hasteMap.getModule('Channel', 'ios');
  console.log(module.path)
})
