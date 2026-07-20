OKay now let's create the whole db schema again from scratch for earthora.

First of all I wan to store the user detail, table name must be User_details some things must be filled by the user suring signup like meail while the rest of the thing will be sutomatic store in the db in the checkout page but i want user_name to be there on signup page as well and it must have the following schema:

id int primary key auto_increment
user_email varchar(255) not null unique
user_password varchar(255) not null
user_name varchar(255) not null
user_phone varchar(255) not null
user_address varchar(255) not null
user_city varchar(255) not null
user_state varchar(255) not null
user_zip varchar(255) not null
user_country varchar(255) not null
user_created_at timestamp default current_timestamp
user_updated_at timestamp default current_timestamp on update current_timestamp


The Gallery page and the Recepies page must be static only no DB

Store Contact us form details in the DB with the name Contact_details and the following schema:
id int primary key auto_increment
contact_name varchar(255) not null
contact_email varchar(255) not null
contact_phone varchar(255) not null
contact_message text not null
contact_created_at timestamp default current_timestamp

I want a db table to store cart details. table name must be Cart_details and it must have the following schema:
id int primary key auto_increment
cart_user_id varchar(255) not null
cart_product_id varchar(255) not null
cart_product_quantity varchar(255) not null
cart_product_price varchar(255) not null
cart_created_at timestamp default current_timestamp
cart_updated_at timestamp default current_timestamp on update current_timestamp

Now let's create a table to store orders. table name must be Orders and it must have the following schema:
id int primary key auto_increment
order_user_id varchar(255) not null
order_product_id varchar(255) not null
order_product_quantity varchar(255) not null
order_product_price varchar(255) not null
order_created_at timestamp default current_timestamp
order_updated_at timestamp default current_timestamp on update current_timestamp

Now lets create a table to store payment details. table name must be Payments and it must have the following schema:
id int primary key auto_increment
payment_order_id varchar(255) not null
payment_amount varchar(255) not null
payment_status varchar(255) not null (payment_status can be pending, completed, failed or refunded)
payment_method varchar(255) not null (payment_method can be credit card, debit card, net banking, UPI)
payment_transaction_id varchar(255) not null
payment_created_at timestamp default current_timestamp
payment_updated_at timestamp default current_timestamp on update current_timestamp

Now lets create a table for oeder hisotry. table name must be Order_history and it must have the following schema:
id int primary key auto_increment
order_id varchar(255) not null
order_status varchar(255) not null (order_status can be pending, processing, shipped, delivered or cancelled)
order_created_at timestamp default current_timestamp
order_updated_at timestamp default current_timestamp on update current_timestamp

Now create DB for admin pannelwere they can see the traffic from where and which devices as alreaady define in the snslytical page in the admin pannel.
table name must be Admin_analytics and it must have the following schema:
id int primary key auto_increment
page_name varchar(255) not null
visitor_ip varchar(255) not null
visitor_device varchar(255) not null
visitor_os varchar(255) not null
visitor_browser varchar(255) not null
visitor_country varchar(255) not null
visitor_city varchar(255) not null
visitor_created_at timestamp default current_timestamp
visitor_updated_at timestamp default current_timestamp on update current_timestamp


Right now do this and also see the frontend if any of the field is extra in the db schema and is not in the fronend and add that in the frontend 


Okay now let's go on admin side, crete a DB for product listing form which is in admin-earthora/products page it should have the following schema:
id int primary key auto_increment
product_slug varchar(255) not null unique
product_name varchar(255) not null
product_description text not null
product_category varchar(255) not null
product_price varchar(255) not null
product_image varchar(255) not null
product_created_at timestamp default current_timestamp
product_updated_at timestamp default current_timestamp on update current_timestamp  check the Add New Product from and add all the fields that are in that forms and not here and all of them must be not null do add the logic that as soon as the user add teh product images in the Add New Product form then it should be uploaded to the storage and the url should be stored in the db in the product_image field and similar will happen in the updates field too


Now create a DB for coupon page it should have the coupon_details table name and the data schema should be:
id int primary key auto_increment
coupon_code varchar(255) not null unique
coupon_discount_type varchar(255) not null (coupon_discount_type can be percentage or flat amount)
coupon_discount_amount varchar(255) not null (coupon_discount_amount can be percentage or flat amount)
coupon_discount_value varchar(255) not null (coupon_discount_value can be percentage or flat amount)
coupon_description text not null
coupon_created_at timestamp default current_timestamp
coupon_updated_at timestamp default current_timestamp on update current_timestamp take the rest of the field from the Create Coupon from as well

Now create a DB for festival Deals with the table name festival_details and the data schema must be:
id int primary key auto_increment
festival_title varchar(255) not null
festival_description text not null
festival_start_date timestamp default current_timestamp
festival_end_date timestamp default current_timestamp on update current_timestamp take the rest of the field from the Create Festival Deal from as well also add more fields after reading the Create Festive Deal form 

When the user orders something from the website then there order details all the things from the order table must be shown in the admin-earthora/orders and from here the user can change the status like the order is processing, packed or delivered 