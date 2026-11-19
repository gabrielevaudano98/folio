# System design

How a request flows, and the domain model behind it.

```board
// architecture
// domain model
user: actor "Customer" @40,120
web: browser "Web app" @150,80
api: component "Orders API" @400,105
q: queue "Events" @400,240
db: cylinder "Orders DB" @660,80
worker: server "Worker" @680,230
backend: group "Backend" @370,40 420x300
Order: class "Order" @60,420 [
  + id: UUID
  + total: Money
  --
  + pay(): void
  + cancel(): void
]
Payable: interface "Payable" @330,420 [
  + pay(): void
]
Line: class "OrderLine" @60,640 [
  + sku: String
  + qty: Int
]
customer: table "customer" @560,420 [
  id uuid PK
  email text
  created_at timestamp
]
note: note "Edit me in the visual view or in code" @650,660 200x70

user -> web "browses"
web -> api "HTTPS"
api -> db "SQL"
api -> q "publishes" {route: curved}
q --> worker
Order ..|> Payable
Order *-- Line "1..*"
note.right -> customer.bottom
```
