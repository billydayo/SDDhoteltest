# Data Model: Sunny 訂房平台

## Overview

This feature uses a browser-local data model with explicit entity boundaries and centralized access functions. The entities are intentionally small and replaceable so the app can later be migrated to a real backend API without rewriting the UI logic.

## Entity: users

| Field | Type | Notes |
|---|---|---|
| id | string | Unique user identifier |
| email | string | Unique login identifier |
| password | string | Demo-only password value stored in local app state |
| role | enum | `guest`, `member`, `admin` |
| displayName | string | Shown in header and order records |
| phone | string | Optional contact info for booking |
| createdAt | string | ISO date/time string |

**Validation rules**:
- Email must be unique across users
- Password is required for registration/login
- Member and admin roles can access feature-specific views

**Relationships**:
- One user can create many orders
- One user can submit many reviews
- One user can submit many refund requests

## Entity: rooms

| Field | Type | Notes |
|---|---|---|
| id | string | Unique room identifier |
| name | string | Displayed room name |
| type | string | e.g. double, twin, suite |
| maxGuests | number | Integer count |
| nightlyPrice | number | Integer TWD value |
| images | string[] | Photo URLs or local asset references |
| amenities | string[] | Facilities list |
| description | string | Marketing copy |
| status | enum | `available`, `booked`, `maintenance` |
| averageRating | number | Derived from published reviews |
| createdAt | string | ISO date/time string |

**Validation rules**:
- `nightlyPrice` must be integer value in TWD
- `maxGuests` must be greater than 0
- `status` must be one of the allowed values

**Relationships**:
- One room may have many orders
- One room may have many reviews

## Entity: orders

| Field | Type | Notes |
|---|---|---|
| id | string | Unique order identifier |
| userId | string | Member who placed the booking |
| roomId | string | Booked room |
| checkIn | string | `YYYY-MM-DD` |
| checkOut | string | `YYYY-MM-DD` |
| nights | number | `checkOut - checkIn` |
| guestCount | number | Number of guests |
| contactName | string | Booking contact |
| phone | string | Contact phone |
| paymentMethod | enum | `LINE Pay`, `credit-card`, `bank-transfer` |
| totalAmount | number | Integer TWD value locked at order creation |
| status | enum | `confirmed`, `refund-pending`, `refunded`, `cancelled`, `completed` |
| createdAt | string | ISO date/time string |

**Validation rules**:
- `checkOut > checkIn`
- `guestCount <= room.maxGuests`
- `totalAmount` must be immutable after creation
- Overlap checks must reject conflicting bookings for the same room

**State transitions**:
- `confirmed` → `refund-pending` → `refunded` or back to `confirmed`
- `confirmed` → `completed` after check-out date passes
- `confirmed` → `cancelled` by admin

## Entity: reviews

| Field | Type | Notes |
|---|---|---|
| id | string | Unique review ID |
| orderId | string | Linked booking |
| roomId | string | Reviewed room |
| userId | string | Review author |
| rating | number | Integer 1–5 |
| comment | string | Review text |
| category | string | e.g. cleanliness, service, value |
| status | enum | `pending`, `approved`, `rejected` |
| createdAt | string | ISO date/time string |

**Validation rules**:
- One review per order
- Only members with an accomplished stay can review
- Ratings must be 1–5
- Only `approved` reviews are shown publicly

## Entity: refunds

| Field | Type | Notes |
|---|---|---|
| id | string | Unique refund request ID |
| orderId | string | Related order |
| userId | string | Requesting member |
| reason | string | User-submitted reason |
| amount | number | Calculated refund amount |
| status | enum | `pending`, `approved`, `rejected` |
| adminNote | string | Optional comment |
| createdAt | string | ISO date/time string |
| reviewedAt | string | Optional ISO date/time |

**Validation rules**:
- Only one pending refund per order
- Cannot be created after check-in or if already refunded
- Refund amount is computed from policy

## Entity: siteContent

| Field | Type | Notes |
|---|---|---|
| id | string | Fixed record ID |
| heroTitle | string | Home page title |
| heroSubtitle | string | Promotional subheading |
| heroImage | string | Main banner image |
| updatedAt | string | ISO date/time string |

## Relationships summary

- `users` 1:N `orders`
- `users` 1:N `reviews`
- `users` 1:N `refunds`
- `rooms` 1:N `orders`
- `rooms` 1:N `reviews`
- `orders` 1:1 `reviews`
- `orders` 1:1 `refunds`

## Data access patterns

- initializeSeedData() creates all default collections if empty
- getUsers(), getRooms(), getOrders(), getReviews(), getRefunds(), getSiteContent() read state
- createUser(), createOrder(), submitReview(), requestRefund(), updateRoomStatus(), updateSiteContent() mutate state
- All writes go through centralized functions to keep inventory and persistence consistent
