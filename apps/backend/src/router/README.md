# architecture of our routers

router -> service -> repository
service -> database
service -> third-party

the layer of service is optional, for simple routers, a router file can use repository/database/third-party directly
but if there is a service for a given router, router should not call repository/database/third-party directly
