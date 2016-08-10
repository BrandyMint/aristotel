# aristotel


Пример вызова скрипта:

```
<!-- OneClickAnalytics counter -->
<script type="text/javascript">
var APP_ID = '???';
var API_URL = ???';
window.art=window.art||[],art.load=function(t,r){art.appId=t,art.config=r=r||{};var e=r.forceSSL||"https:"===document.location.protocol,a=document.createElement("script");a.type="text/javascript",a.async=!0,a.src=API_URL;var n=document.getElementsByTagName("script")[0];n.parentNode.insertBefore(a,n);for(var o=function(t){return function(){art.push([t].concat(Array.prototype.slice.call(arguments,0)))}},c=["clearEventProperties","identify","setEventProperties","track","unsetEventProperty"],s=0;s<c.length;s++)art[c[s]]=o(c[s])},art.load(APP_ID);
</script>
<!-- /OneClickAnalytics counter -->
```
