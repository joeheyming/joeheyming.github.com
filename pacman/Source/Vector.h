#ifndef VECTOR_H
#define VECTOR_H

#include <iostream>

using namespace std;

class Vector{
public:
	double x, y, z;

	Vector(){ x = y = z = 0.0; };
	Vector(double _x, double _y, double _z);
	Vector& operator=(double * a);
	Vector& operator=(const Vector& v);
	Vector operator *(const double i);
	Vector operator +(const Vector& v);
	Vector operator +(const double i);
	Vector operator -(const Vector& v);
	Vector operator -(const double i);
	Vector operator -();
	friend ostream& operator <<(ostream& outputStream, const Vector& v);
};

#endif
