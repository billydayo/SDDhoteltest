# Quickstart: Sunny 訂房平台

## Prerequisites

- A modern browser (Chrome, Edge, Firefox, or Safari)
- No install step required
- Optional: a simple static server such as `python -m http.server 8000`

## Run the app

### Option A: direct open
1. Open the project folder in a file explorer.
2. Open `index.html` directly in the browser.

### Option B: local static server
1. From the project root, run:
   `python -m http.server 8000`
2. Open `http://localhost:8000/`

## End-to-end validation flow

### 1. Guest browsing
- Open the home page
- Verify the room cards appear
- Try keyword search, date filters, guest count, and price cap
- Switch room type tabs and confirm the list updates without resetting unrelated filters
- Open a room detail page and confirm the rating, comments, room status, and total price are visible

### 2. Member login and account management
- Sign up with a new email address
- Confirm the app auto-logs in and shows the display name in the header
- Log out and log back in with the demo account `guest@sunny.com / guest123`
- Update the display name in account settings and verify it reflects across the app

### 3. Booking flow
- Open a room detail page with valid dates
- Proceed through the three-step booking form
- Choose a simulated payment method
- Confirm the order summary and submit
- Verify the confirmation page and generated order number display correctly

### 4. Refund flow
- Create a new order that is still upcoming
- Submit a refund request with a reason
- Confirm the order moves to refund-pending and cannot be resubmitted until admin processing is complete
- Verify admin approval and rejection states update the member view correctly

### 5. Review moderation
- Submit a review on an arrived stay
- Confirm it remains hidden before approval
- Approve or reject the review from the admin panel and confirm it appears or disappears appropriately

### 6. Admin workspace
- Sign in as `admin@sunny.com / admin123`
- Check the dashboard statistics
- Add or edit a room, change maintenance status, and ensure the frontend updates
- Search orders, change an order status, and confirm the order view updates for the member
- Export a report and verify the fallback behavior when export libraries are unavailable

### 7. Risk score flow
- Open the risk check page
- Upload a photo and confirm the score, grade, and suggestions appear
- Test an invalid file to confirm an error appears
- Confirm no network request is triggered while the analysis runs

## Expected results

- Search and booking logic behaves correctly for overlapping dates and room state constraints
- The app remains fully functional without any build step
- The interface clearly marks all payment and login flows as demo-only simulations
- All data remains in the browser and is restored from `localStorage` after reload
