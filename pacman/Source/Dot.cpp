#include "Dot.h"

Dot::Dot(Vector startPos){

	//location = p;

	//scale = _scale;

	radius = 0; //initialized to no dot being drawn
	
	position = startPos;
}

void Dot::draw(){
	//there is no dot to draw
	if(radius == 0)
		return;

	glPushMatrix();
		qd = gluNewQuadric();

		// bring the model to the coordinates
		glTranslatef(position.x,
			position.y,
			position.z);
	
		glColor4f(1.0, 1.0, 1.0, 1.0);
		glPushMatrix();
			gluSphere(qd,radius,8,8);
		glPopMatrix();

		gluDeleteQuadric(qd);

	glPopMatrix();

}

//test if dot and object collide
int Dot::collisionTest(Vector pos, double rad){

	if(radius == 0)
		return 0;

	//dot is below object
	if((position.x - radius < pos.x + rad) && 
		(position.x + radius > pos.x - rad) &&
		(position.y + radius > pos.y - rad) && 
		(position.y - radius < pos.y + rad))
		return radius;

	//dot is above object
	if((position.x - radius < pos.x + rad) && 
		(position.x + radius > pos.x - rad) &&
		(position.y + radius > pos.y - rad) && 
		(position.y - radius < pos.y + rad))
		return radius;

	if((position.x - radius < pos.x + rad) && 
		(position.x + radius > pos.x - rad) &&
		(position.y + radius > pos.y - rad) && 
		(position.y - radius < pos.y + rad))
		return radius;

	if((position.x - radius < pos.x + rad) && 
		(position.x + radius > pos.x - rad) &&
		(position.y + radius > pos.y - rad) && 
		(position.y - radius < pos.y + rad))
		return radius;

	return 0;
}

