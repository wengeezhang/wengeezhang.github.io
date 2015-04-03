self.addEventListener('push', function(event) {  
  console.log('Received a push message', event);

  var title = 'Hello';  
  var body = 'This message is pushed by google\'s GCM';  
  var icon = 'https://simple-push-demo.appspot.com/images/touch/icon-128x128.png';  
  var tag = 'simple-push-demo-notification-tag';

  event.waitUntil(  
    self.registration.showNotification(title, {  
      body: body,  
      icon: icon,  
      tag: tag  
    })  
  );  
});
