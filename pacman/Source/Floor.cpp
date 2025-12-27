#include "Floor.h"

Floor::Floor(double _height, double _scale){
	height = _height;
	scale = _scale;

	north = NULL;
	south = NULL;
	west = NULL;
	east = NULL;

	material_emission = new GLfloat[4];
	material_normal = new GLfloat[4];

	material_emission[0] = 0.0;
	material_emission[1] = 0.0;
	material_emission[2] = 1.0;
	material_emission[3] = 1.0;

	material_normal[0] = 0.0;
	material_normal[1] = 0.0;
	material_normal[2] = 0.0;
	material_normal[3] = 1.0;

	Vector dotPos = position;
	dotPos.x = dotPos.x + scale/2;
	dotPos.y = dotPos.y + scale/2;
	dotPos.z = dotPos.z + height*scale + scale/2;

	dot = new Dot(dotPos);
}

int Floor::updateDot(Vector pos, double rad){

	pos.x = pos.x - position.x;
	pos.y = pos.y - position.y;
	pos.z = pos.z - position.z;

	int size = dot->collisionTest(pos, rad/2);
	if(size > 0){
		dot->setRadius(0);
		return size;
	}
	return 0;
}

void Floor::draw(float transparency){
	if(height == 0)
		return;

	glPushMatrix();

		// draw the top
		glColor4f(1.3-1.0/height, 1.3-1.0/height, 1.3-1.0/height, transparency);
		glTranslatef(position.x, position.y, position.z);
		glBegin(GL_POLYGON);
			glVertex3f(0, 0, (scale)*height);
			glVertex3f(scale, 0, (scale)*height);
			glVertex3f(scale, scale, (scale)*height);
			glVertex3f(0, scale, (scale)*height);
		glEnd();

		//bottom of square
		glColor4f(1.0, 1.0, 1.0, transparency);
		glBegin(GL_POLYGON);
			glVertex3f(0, scale, 0);
			glVertex3f(scale, scale, 0);
			glVertex3f(scale, 0, 0);
			glVertex3f(0, 0, 0);
		glEnd();
/*
	glColor4f(0.0,0.0,0.0,1.0);
	glLineWidth(3.0);
	glBegin(GL_LINE_LOOP);
	glVertex3f(0,0,(scale)*height);
	glVertex3f(scale,0,(scale)*height);
	glVertex3f(scale,scale,(scale)*height);
	glVertex3f(0,scale,(scale)*height);
	glEnd();
*/
		drawWalls(transparency);

		dot->draw();

	glPopMatrix();
}

void Floor::drawWalls(float transparency){
	double neighborHeight;
	glPushMatrix();
		// make the walls glow blue
		glMaterialfv(GL_FRONT, GL_EMISSION, material_emission);

		// draw the walls blue
		glColor4f(0.0, 0.0, 1.0, transparency);

		neighborHeight = 0;
		//north
		if(north != NULL)
			neighborHeight = north->getHeight();
		if(neighborHeight != height){
			glBegin(GL_POLYGON);
					glVertex3f(0, scale, (scale)*height);
					glVertex3f(scale, scale, (scale)*height);
					if(height > neighborHeight){
						glVertex3f(scale, scale, neighborHeight);
						glVertex3f(0, scale, neighborHeight);
					}
			glEnd();
		}

		neighborHeight = 0;
		//south
		if(south != NULL)
			neighborHeight = south->getHeight();
		if(neighborHeight != height){
			glBegin(GL_POLYGON);
				if(height > neighborHeight){
					glVertex3f(0, 0, neighborHeight);
					glVertex3f(scale, 0, neighborHeight);
				}
				glVertex3f(scale, 0, (scale)*height);
				glVertex3f(0, 0, (scale)*height);
			glEnd();
		}

		neighborHeight = 0;
		//east
		if(east != NULL)
			neighborHeight = east->getHeight();
		if(neighborHeight != height){
			glBegin(GL_POLYGON);
				if(height > neighborHeight){
					glVertex3f(scale, 0, neighborHeight);
					glVertex3f(scale, scale, neighborHeight);
				}
				glVertex3f(scale, scale, (scale)*height);
				glVertex3f(scale, 0, (scale)*height);
			glEnd();
		}

		neighborHeight = 0;
		//west
		if(west != NULL)
			neighborHeight = west->getHeight();
		if(neighborHeight != height){
			glBegin(GL_POLYGON);
				glVertex3f(0, 0, (scale)*height);
				glVertex3f(0, scale, (scale)*height);
				if(height > neighborHeight){
					glVertex3f(0, scale, neighborHeight);
					glVertex3f(0, 0, neighborHeight);
				}
			glEnd();
		}

		// change the material property back to normal (no glowing)
		glMaterialfv(GL_FRONT, GL_EMISSION, material_normal);
	glPopMatrix();
}

bool Floor::intersect(Vector v){
	if( v.x > position.x && v.x < (position.x + scale) &&
			v.y > position.y && v.y < (position.y + scale) )
		return true;
	return false;
}
