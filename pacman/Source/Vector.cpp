#include "Vector.h"

Vector::Vector(double _x, double _y, double _z){
	x = _x;
	y = _y;
	z = _z;
}

Vector& Vector::operator =(double * a) {
	x = a[0];
	y = a[1];
	z = a[2];
	return *this; 
}

Vector& Vector::operator =(const Vector& v){
	x = v.x;
	y = v.y;
	z = v.z;
	return *this;
}

Vector Vector::operator *(const double i){
	return Vector(this->x*i,this->y*i,this->z*i);
}

Vector Vector::operator +(const Vector& v){
	return Vector(this->x+v.x,this->y+v.y,this->z+v.z);
}

Vector Vector::operator +(const double i){
	return Vector(this->x+i,this->y+i,this->z+i);
}

Vector Vector::operator -(){
	return Vector(-this->x,-this->y,-this->z);
}

Vector Vector::operator -(const Vector& v){
	return Vector(this->x-v.x,this->y-v.y,this->z-v.z);
}

Vector Vector::operator -(const double i){
	return Vector(this->x-i,this->y-i,this->z-i);
}

ostream& operator <<(ostream& outputStream, const Vector& v){
	outputStream << "<" << v.x << ", " << v.y << ", " << v.z << ">";
	return outputStream;
}
